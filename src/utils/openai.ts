import https from 'https';
import type { CreateCompletionRequest, CreateCompletionResponse } from 'openai';
import { encoding_for_model as encodingForModel } from '@dqbd/tiktoken';
import { KnownError } from './error.js';

const createCompletion = (
	apiKey: string,
	json: CreateCompletionRequest,
) => new Promise<CreateCompletionResponse>((resolve, reject) => {
	const postContent = JSON.stringify(json);
	const request = https.request(
		{
			port: 443,
			hostname: 'api.openai.com',
			path: '/v1/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': postContent.length,
				Authorization: `Bearer ${apiKey}`,
			},
			timeout: 10_000, // 10s
		},
		(response) => {
			if (
				!response.statusCode
				|| response.statusCode < 200
				|| response.statusCode > 299
			) {
				let errorMessage = `OpenAI API Error: ${response.statusCode} - ${response.statusMessage}`;
				if (response.statusCode === 500) {
					errorMessage += '; Check the API status: https://status.openai.com';
				}

				return reject(new KnownError(errorMessage));
			}

			const body: Buffer[] = [];
			response.on('data', chunk => body.push(chunk));
			response.on('end', () => {
				resolve(
					JSON.parse(Buffer.concat(body).toString()),
				);
			});
		},
	);
	request.on('error', reject);
	request.on('timeout', () => {
		request.destroy();
		reject(new KnownError('Request timed out'));
	});

	request.write(postContent);
	request.end();
});

const sanitizeMessage = (message: string) => message.trim().replace(/[\n\r]/g, '').replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const getPrompt = (locale: string, diff: string) => `Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything, the response must be in the language ${locale}:\n${diff}`;

const model = 'text-davinci-003';
const encoder = encodingForModel(model);

export const generateCommitMessage = async (
	apiKey: string,
	locale: string,
	diff: string,
	completions: number,
) => {
	const prompt = getPrompt(locale, diff);

	/**
	 * text-davinci-003 has a token limit of 4000
	 * https://platform.openai.com/docs/models/overview#:~:text=to%20Sep%202021-,text%2Ddavinci%2D003,-Can%20do%20any
	 */
	if (encoder.encode(prompt).length > 4000) {
		throw new KnownError('The diff is too large for the OpenAI API. Try reducing the number of staged changes, or write your own commit message.');
	}

	try {
		const completion = await createCompletion(apiKey, {
			model,
			prompt,
			temperature: 0.7,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
			max_tokens: 200,
			stream: false,
			n: completions,
		});

		return deduplicateMessages(
			completion.choices
				.map(choice => sanitizeMessage(choice.text!)),
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		throw errorAsAny;
	}
};
