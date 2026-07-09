import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt, generateDescriptionPrompt } from './prompt.js';
import { isHeadless } from './headless.js';

const shouldLogDebug = () =>
	Boolean(process.env.DEBUG || process.env.AICOMMITS_DEBUG) && !isHeadless();

/**
 * Extracts the actual response from reasoning model outputs.
 * Reasoning models (like DeepSeek R1, QwQ, etc.) include their thought process
 * in <think>...</think> tags. We need to extract the content after these tags.
 */
const extractResponseFromReasoning = (message: string): string => {
	// Pattern to match <think>...</think> tags and everything before the actual response
	// This handles both single-line and multi-line think blocks
	const thinkPattern = /<think>[\s\S]*?<\/think>/gi;

	// Remove all <think>...</think> blocks and any content before the first think block
	let cleaned = message.replace(thinkPattern, '');

	// Remove any leading/trailing whitespace and newlines
	cleaned = cleaned.trim();

	return cleaned;
};

const sanitizeMessage = (message: string) => {
	// First, extract response from reasoning models if present
	let processed = extractResponseFromReasoning(message);

	// Then apply existing sanitization
 	const sanitized = processed
 		.trim()
 		.split('\n')[0] // Take only the first line
 		.replace(/(\w)\.$/, '$1')
 		.replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
 		.replace(/^<[^>]*>\s*/, ''); // Remove leading tags

 	return sanitized;
};

/** Sanitize description/body (multi-line): strip reasoning blocks, trim, remove surrounding quotes. */
const sanitizeDescription = (message: string) => {
	let processed = extractResponseFromReasoning(message);
	return processed
		.trim()
		.replace(/^["'`]|["'`]$/g, '')
		.replace(/^<[^>]*>\s*/, '');
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

/**
 * Some local OpenAI-compatible servers (LM Studio, Ollama) return responses that
 * the AI SDK v6 strict response validation rejects, surfacing as
 * "Invalid JSON response". We normalise the common quirks here before the SDK
 * parses them: reasoning models (e.g. Qwen) may emit an empty `content` with
 * the answer in `reasoning_content`, and `finish_reason` / `usage` may be null.
 */
const sanitizeChatChunk = (chunk: any): any => {
	if (!chunk || typeof chunk !== 'object') return chunk;
	if (Array.isArray(chunk.choices)) {
		for (const choice of chunk.choices) {
			const messageOrDelta = choice?.message ?? choice?.delta;
			if (
				messageOrDelta &&
				(messageOrDelta.content === null || messageOrDelta.content === undefined)
			) {
				const fallback = messageOrDelta.reasoning_content ?? messageOrDelta.reasoning;
				if (typeof fallback === 'string' && fallback.length > 0) {
					messageOrDelta.content = fallback;
				}
			}
			if (choice?.finish_reason === null || choice?.finish_reason === undefined) {
				choice.finish_reason = 'stop';
			}
		}
	}
	if (chunk.usage === null || chunk.usage === undefined) {
		chunk.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
	}
	return chunk;
};

/**
 * Re-emit a single SSE event with its `data:` payload normalised. Returns null
 * to drop a malformed chunk (so one bad chunk doesn't abort the whole request).
 */
const sanitizeSseEvent = (event: string): string | null => {
	if (event.trim() === '') return null;
	const lines = event.split('\n');
	const dataLines: string[] = [];
	const otherLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).replace(/^ /, ''));
		} else {
			otherLines.push(line);
		}
	}
	const dataValue = dataLines.join('');
	if (dataValue === '[DONE]') {
		return 'data: [DONE]';
	}
	if (dataValue.length === 0) {
		// keep-alive / comment event: pass through unchanged
		return event;
	}
	let parsed: any;
	try {
		parsed = JSON.parse(dataValue);
	} catch {
		// Drop chunks that are not valid JSON (e.g. truncated stream output from
		// a local model). This keeps the request alive instead of throwing
		// "Invalid JSON response" for a single bad chunk.
		return null;
	}
	const sanitized = sanitizeChatChunk(parsed);
	return [...otherLines, `data: ${JSON.stringify(sanitized)}`].join('\n');
};

/**
 * Wrap a streaming (text/event-stream) response so that each SSE event's JSON
 * payload is normalised for local-model quirks, and malformed chunks are dropped.
 */
const sanitizeEventStream = (response: Response): Response => {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/event-stream') || !response.body) {
		return response;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';

	const processBuffer = (isFinal: boolean): string => {
		const events = buffer.split('\n\n');
		let remaining = '';
		if (!isFinal) {
			remaining = events.pop() ?? '';
		}
		let out = '';
		for (const event of events) {
			const sanitized = sanitizeSseEvent(event);
			if (sanitized !== null) {
				out += sanitized + '\n\n';
			}
		}
		buffer = remaining;
		return out;
	};

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					const out = processBuffer(true);
					if (out) controller.enqueue(encoder.encode(out));
					controller.close();
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const out = processBuffer(false);
				if (out) controller.enqueue(encoder.encode(out));
			} catch (err) {
				controller.error(err);
			}
		},
	});

	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers({ 'content-type': 'text/event-stream' }),
	});
};

/**
 * Custom fetch that repairs/normalises OpenAI-compatible streaming responses
 * from local servers before handing them to the AI SDK.
 */
const createSanitizingFetch = (originalFetch: typeof fetch): typeof fetch => {
	const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
		const response = await originalFetch(input, init);
		return sanitizeEventStream(response);
	};
	return wrapped as typeof fetch;
};

const isLocalProvider = (baseUrl: string) =>
	baseUrl.startsWith('http://localhost') ||
	baseUrl.startsWith('http://127.0.0.1') ||
	baseUrl.includes('127.0.0.1') ||
	baseUrl.includes('localhost');

/**
 * Transform AI SDK response/parse errors into a helpful, actionable message.
 * Local OpenAI-compatible servers (LM Studio, Ollama) with reasoning models
 * (e.g. Qwen) frequently return non-conformant responses.
 */
export const formatProviderError = (error: any, baseUrl: string): unknown => {
	const message = typeof error?.message === 'string' ? error.message : '';
	const name = error?.name ?? '';
	const isJsonError =
		message.includes('Invalid JSON response') ||
		message.includes('Invalid response data') ||
		message.toLowerCase().includes('json parse error') ||
		name === 'AI_InvalidResponseDataError' ||
		name === 'AI_JSONParseError' ||
		name === 'AI_TypeValidationError';

	if (!isJsonError) return error;

	const responseBody =
		typeof error?.responseBody === 'string' ? error.responseBody : '';
	const isLocal = isLocalProvider(baseUrl);

	const parts: string[] = [];
	parts.push(
		'The AI provider returned a response that could not be parsed as JSON.'
	);
	if (responseBody) {
		parts.push(`\nServer response:\n${responseBody.slice(0, 1000)}`);
	}
	if (isLocal) {
		parts.push(
			'\nThis usually happens with local OpenAI-compatible servers (LM Studio, Ollama) and reasoning models such as Qwen. Try the following:'
		);
		parts.push(
			'- Use a non-reasoning model, or disable "thinking"/reasoning in your local server.'
		);
		parts.push('- Make sure the model is fully loaded and LM Studio is up to date.');
		parts.push('- Increase the timeout: aicommits config set timeout 120000');
		parts.push(
			'- Reduce the amount of context sent, or pick a model with a larger context window.'
		);
	}
	return new KnownError(parts.join('\n'));
};

/**
 * Build the chat provider, attaching a fetch wrapper that tolerates the quirks
 * of local OpenAI-compatible servers.
 */
export const createChatProvider = (
	baseUrl: string,
	apiKey: string,
	headers?: Record<string, string>
) => {
	const fetchWrapper = createSanitizingFetch(globalThis.fetch);
	return baseUrl === 'https://api.openai.com/v1'
		? createOpenAI({ apiKey, fetch: fetchWrapper })
		: createOpenAICompatible({
				name: 'custom',
				apiKey,
				baseURL: baseUrl,
				headers,
				fetch: fetchWrapper,
		  });
};

const shortenCommitMessage = async (
	provider: any,
	model: string,
	message: string,
	maxLength: number,
	timeout: number
) => {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), timeout);

	try {
		const result = await generateText({
			model: provider(model),
			system: `You are a tool that shortens git commit messages. Given a commit message, make it shorter while preserving the key information and format. The shortened message must be ${maxLength} characters or less. Respond with ONLY the shortened commit message.`,
			prompt: message,
			temperature: 0.2,
			maxRetries: 2,
			maxOutputTokens: 500,
			abortSignal: abortController.signal,
		});
		clearTimeout(timeoutId);
		return sanitizeMessage(result.text);
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
};

export type GenerateCommitMessageOptions = {
	baseUrl: string;
	apiKey: string;
	model: string;
	locale: string;
	diff: string;
	completions: number;
	maxLength: number;
	type: CommitType;
	timeout: number;
	customPrompt?: string;
	headers?: Record<string, string>;
};

export const generateCommitMessage = async ({
	baseUrl,
	apiKey,
	model,
	locale,
	diff,
	completions,
	maxLength,
	type,
	timeout,
	customPrompt,
	headers,
}: GenerateCommitMessageOptions) => {
	if (shouldLogDebug()) {
		console.log('Diff being sent to AI:');
		console.log(diff);
	}

	try {
		const provider = createChatProvider(baseUrl, apiKey, headers);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		const promises = Array.from({ length: completions }, () =>
			generateText({
				model: provider(model),
				system: generatePrompt(locale, maxLength, type, customPrompt),
				prompt: diff,
				temperature: 0.4,
				maxRetries: 2,
				maxOutputTokens: 2000,
				abortSignal: abortController.signal,
			})
		);
		const results = await (async () => {
			try {
				return await Promise.all(promises);
			} finally {
				clearTimeout(timeoutId);
			}
		})();
		let texts = results.map((r) => r.text);
		let messages = deduplicateMessages(
			texts.map((text: string) => sanitizeMessage(text))
		);

		// Shorten messages that exceed maxLength
		const MAX_SHORTEN_RETRIES = 3;
		for (let retry = 0; retry < MAX_SHORTEN_RETRIES; retry++) {
			let needsShortening = false;
			const shortenedMessages = await Promise.all(
				messages.map(async (msg) => {
					if (msg.length <= maxLength) {
						return msg;
					}
					needsShortening = true;
					try {
						return await shortenCommitMessage(provider, model, msg, maxLength, timeout);
					} catch (error) {
						// If shortening fails, keep the original and continue
						return msg;
					}
				})
			);
			messages = deduplicateMessages(shortenedMessages);
			if (!needsShortening) break;
		}

		const usage = {
			prompt_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).promptTokens || 0),
				0
			),
			completion_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).completionTokens || 0),
				0
			),
			total_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).totalTokens || 0),
				0
			),
		};
		return { messages, usage };
	} catch (error) {
		const errorAsAny = error as any;

		// Handle AbortController timeout
		if (
			errorAsAny.name === 'AbortError' ||
			errorAsAny.message?.includes('aborted') ||
			errorAsAny.message?.includes('This operation was aborted')
		) {
			throw new KnownError(
				`Request timed out after ${timeout / 1000} seconds. The API took too long to respond. Try again or use a different model.`
			);
		}

		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		if (errorAsAny.status === 429) {
			const resetHeader = errorAsAny.headers?.get('x-ratelimit-reset');
			let rateLimitMessage = 'Rate limit exceeded';
			if (resetHeader) {
				const resetTime = parseInt(resetHeader);
				const now = Date.now();
				const waitMs = resetTime - now;
				const waitSec = Math.ceil(waitMs / 1000);
				if (waitSec > 0) {
					let timeStr: string;
					if (waitSec < 60) {
						timeStr = `${waitSec} second${waitSec === 1 ? '' : 's'}`;
					} else if (waitSec < 3600) {
						const minutes = Math.ceil(waitSec / 60);
						timeStr = `${minutes} minute${minutes === 1 ? '' : 's'}`;
					} else {
						const hours = Math.ceil(waitSec / 3600);
						timeStr = `${hours} hour${hours === 1 ? '' : 's'}`;
					}
					rateLimitMessage += `. Retry in ${timeStr}.`;
				}
			}
			throw new KnownError(rateLimitMessage);
		}

		if (errorAsAny.message?.includes('Provider returned error')) {
			throw new KnownError(
				`Provider failed to process your request. Try running the command again, or switch to a different model with \`aicommits model\`.`
			);
		}

		const msg = typeof errorAsAny.message === 'string' ? errorAsAny.message.toLowerCase() : '';
		if (
			errorAsAny.status === 404 ||
			msg.includes('unable to access') ||
			(msg.includes('model') &&
				(msg.includes('not found') ||
					msg.includes('does not exist') ||
					msg.includes('deprecated') ||
					msg.includes('unavailable')))
		) {
		const err = new KnownError(`Model "${model}" is not available or has been deprecated.`);
		(err as any).isModelDeprecated = true;
		throw err;
	}

	throw formatProviderError(errorAsAny, baseUrl);
	}
};

export type GenerateCommitDescriptionOptions = {
	baseUrl: string;
	apiKey: string;
	model: string;
	locale: string;
	title: string;
	diff: string;
	timeout: number;
	maxLength: number;
	customPrompt?: string;
	headers?: Record<string, string>;
};

/**
 * Wrap a single line at maxLength by breaking on spaces.
 * Lines that start with "- " or "* " get continuation lines indented with 2 spaces for alignment.
 */
const wrapLine = (line: string, maxLength: number): string => {
	const bulletMatch = /^([-*]\s)/.exec(line);
	const indent = bulletMatch ? '  ' : '';
	const continuationMax = maxLength - indent.length;

	if (line.length <= maxLength) return line;

	const parts: string[] = [];
	let rest = line;
	let isFirst = true;

	while (rest.length > (isFirst ? maxLength : continuationMax)) {
		const maxThisLine = isFirst ? maxLength : continuationMax;
		const chunk = rest.slice(0, maxThisLine);
		const lastSpace = chunk.lastIndexOf(' ');
		const splitAt = lastSpace > 0 ? lastSpace + 1 : maxThisLine;
		const segment = rest.slice(0, splitAt).trim();
		parts.push(isFirst ? segment : indent + segment);
		rest = rest.slice(splitAt).trim();
		isFirst = false;
	}
	if (rest.length > 0) {
		parts.push(isFirst ? rest : indent + rest);
	}
	return parts.join('\n');
};

export const generateCommitDescription = async ({
	baseUrl,
	apiKey,
	model,
	locale,
	title,
	diff,
	timeout,
	maxLength,
	customPrompt,
	headers,
}: GenerateCommitDescriptionOptions) => {
	if (shouldLogDebug()) {
		console.log('Title and diff for description:');
		console.log({ title, diffLength: diff.length });
	}

	const provider = createChatProvider(baseUrl, apiKey, headers);

	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), timeout);

	try {
		const result = await generateText({
			model: provider(model),
			system: generateDescriptionPrompt(locale, maxLength, customPrompt),
			prompt: `Commit message title:\n${title}\n\nCode diff:\n${diff}`,
			temperature: 0.4,
			maxRetries: 2,
			maxOutputTokens: 2000,
			abortSignal: abortController.signal,
		});
		clearTimeout(timeoutId);
		let description = sanitizeDescription(result.text);
		// Enforce line length: wrap any line exceeding maxLength
		description = description
			.split('\n')
			.map((line) => wrapLine(line, maxLength))
			.join('\n');
		return { description, usage: result.usage };
	} catch (error) {
		clearTimeout(timeoutId);
		const errorAsAny = error as any;
		if (
			errorAsAny.name === 'AbortError' ||
			errorAsAny.message?.includes('aborted') ||
			errorAsAny.message?.includes('This operation was aborted')
		) {
			throw new KnownError(
				`Request timed out after ${timeout / 1000} seconds. The API took too long to respond. Try again or use a different model.`
			);
		}
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}
		if (errorAsAny.message?.includes('Provider returned error')) {
			throw new KnownError(
				`Provider failed to process your request. Try running the command again, or switch to a different model with \`aicommits model\`.`
			);
		}
		throw formatProviderError(errorAsAny, baseUrl);
	}
};

export type CombineCommitMessagesOptions = {
	messages: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	locale: string;
	maxLength: number;
	type: CommitType;
	timeout: number;
	customPrompt?: string;
	headers?: Record<string, string>;
};

export const combineCommitMessages = async ({
	messages,
	baseUrl,
	apiKey,
	model,
	locale,
	maxLength,
	type,
	timeout,
	customPrompt,
	headers,
}: CombineCommitMessagesOptions) => {
	try {
		const provider = createChatProvider(baseUrl, apiKey, headers);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		const system = `You are a tool that generates git commit messages. Your task is to combine multiple commit messages into one.

Input: Several commit messages separated by newlines.
Output: A single commit message starting with type like 'feat:' or 'fix:'.

Do not add thanks, explanations, or any text outside the commit message.`;

		const result = await generateText({
			model: provider(model),
			system,
			prompt: messages.join('\n'),
			temperature: 0.4,
			maxRetries: 2,
			maxOutputTokens: 2000,
			abortSignal: abortController.signal,
		});

		clearTimeout(timeoutId);

		let combinedMessage = sanitizeMessage(result.text);

		// Shorten if too long
		if (combinedMessage.length > maxLength) {
			try {
				combinedMessage = await shortenCommitMessage(provider, model, combinedMessage, maxLength, timeout);
			} catch (error) {
				// If shortening fails, keep the original
			}
		}

		return { messages: [combinedMessage], usage: result.usage };
	} catch (error) {
		const errorAsAny = error as any;

		// Handle AbortController timeout
		if (
			errorAsAny.name === 'AbortError' ||
			errorAsAny.message?.includes('aborted') ||
			errorAsAny.message?.includes('This operation was aborted')
		) {
			throw new KnownError(
				`Request timed out after ${timeout / 1000} seconds. The API took too long to respond. Try again or use a different model.`
			);
		}

		if (errorAsAny.message?.includes('Provider returned error')) {
			throw new KnownError(
				`Provider failed to process your request. Try running the command again, or switch to a different model with \`aicommits model\`.`
			);
		}

		throw formatProviderError(errorAsAny, baseUrl);
	}
};
