import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt, commitTypeFormats } from './prompt.js';
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

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

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
		const provider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
						headers,
				  });

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

		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		if (errorAsAny.status === 429) {
			const resetHeader = errorAsAny.headers?.get('x-ratelimit-reset');
			let message = 'Rate limit exceeded';
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
					message += `. Retry in ${timeStr}.`;
				}
			}
			throw new KnownError(message);
		}

		throw errorAsAny;
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
		const provider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
						headers,
				  });

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

		throw errorAsAny;
	}
};
