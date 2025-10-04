import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type {
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
} from 'openai';
import {
	type TiktokenModel,
	// encoding_for_model,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import { generatePrompt } from './prompt.js';

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string
) =>
	new Promise<{
		request: ClientRequest;
		response: IncomingMessage;
		data: string;
	}>((resolve, reject) => {
		const postContent = JSON.stringify(json);
		const request = https.request(
			{
				port: 443,
				hostname,
				path,
				method: 'POST',
				headers: {
					...headers,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postContent),
				},
				timeout,
				agent: proxy ? createHttpsProxyAgent(proxy) : undefined,
			},
			(response) => {
				const body: Buffer[] = [];
				response.on('data', (chunk) => body.push(chunk));
				response.on('end', () => {
					resolve({
						request,
						response,
						data: Buffer.concat(body).toString(),
					});
				});
			}
		);
		request.on('error', reject);
		request.on('timeout', () => {
			request.destroy();
			reject(
				new KnownError(
					`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the OpenAI API status https://status.openai.com`
				)
			);
		});

		request.write(postContent);
		request.end();
	});

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string
) => {
	const { response, data } = await httpsPost(
		'api.openai.com',
		'/v1/chat/completions',
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
		timeout,
		proxy
	);

	if (
		!response.statusCode ||
		response.statusCode < 200 ||
		response.statusCode > 299
	) {
		let errorMessage = `OpenAI API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.statusCode === 500) {
			errorMessage += '\n\nCheck the API status: https://status.openai.com';
		}

		throw new KnownError(errorMessage);
	}

	return JSON.parse(data) as CreateChatCompletionResponse;
};

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, '')
		.replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const isGpt5Model = (model: string): boolean => model.startsWith('gpt-5');

const isReasoningModel = (model: string): boolean =>
	model.startsWith('o1') || model.startsWith('o3');

// const generateStringFromLength = (length: number) => {
// 	let result = '';
// 	const highestTokenChar = 'z';
// 	for (let i = 0; i < length; i += 1) {
// 		result += highestTokenChar;
// 	}
// 	return result;
// };

// const getTokens = (prompt: string, model: TiktokenModel) => {
// 	const encoder = encoding_for_model(model);
// 	const tokens = encoder.encode(prompt).length;
// 	// Free the encoder to avoid possible memory leaks.
// 	encoder.free();
// 	return tokens;
// };

export const generateCommitMessage = async (
	apiKey: string,
	model: TiktokenModel,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	proxy?: string
) => {
	try {
		const isGpt5 = isGpt5Model(model);
		const isReasoning = isReasoningModel(model);

		const promptText = generatePrompt(locale, maxLength, type);

		// Build messages based on model type
		// o1/o3 models don't support system messages - merge into user message
		const messages = isReasoning
			? [
					{
						role: 'user' as const,
						content: `${promptText}\n\n${diff}`,
					},
			  ]
			: [
					{
						role: 'system' as const,
						content: promptText,
					},
					{
						role: 'user' as const,
						content: diff,
					},
			  ];

		// Build request params based on model type
		const requestParams: any = {
			model,
			messages,
		};

		if (isReasoning) {
			// o1/o3 reasoning models: minimal parameters only
			requestParams.max_completion_tokens = 1000;
			requestParams.n = completions;
		} else if (isGpt5) {
			// GPT-5 models: adjusted parameters
			requestParams.temperature = 1;
			requestParams.max_completion_tokens = 3000;
			requestParams.n = completions;
		} else {
			// Legacy models (GPT-3.5, GPT-4): current behavior
			requestParams.temperature = 0.7;
			requestParams.top_p = 1;
			requestParams.frequency_penalty = 0;
			requestParams.presence_penalty = 0;
			requestParams.max_tokens = 200;
			requestParams.stream = false;
			requestParams.n = completions;
		}

		const completion = await createChatCompletion(
			apiKey,
			requestParams,
			timeout,
			proxy
		);

		return deduplicateMessages(
			completion.choices
				.filter((choice) => choice.message?.content)
				.map((choice) => sanitizeMessage(choice.message!.content as string))
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		throw errorAsAny;
	}
};
