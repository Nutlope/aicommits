import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { ChatCompletionRequestMessage, CreateChatCompletionRequest, CreateChatCompletionResponse } from 'openai';
import {
	type TiktokenModel,
	// encoding_for_model,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string,
) => new Promise<{
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
			agent: (
				proxy
					? createHttpsProxyAgent(proxy)
					: undefined
			),
		},
		(response) => {
			const body: Buffer[] = [];
			response.on('data', chunk => body.push(chunk));
			response.on('end', () => {
				resolve({
					request,
					response,
					data: Buffer.concat(body).toString(),
				});
			});
		},
	);
	request.on('error', reject);
	request.on('timeout', () => {
		request.destroy();
		reject(new KnownError(`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the OpenAI API status https://status.openai.com`));
	});

	request.write(postContent);
	request.end();
});

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string,
) => {
	const { response, data } = await httpsPost(
		'api.openai.com',
		'/v1/chat/completions',
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
		timeout,
		proxy,
	);

	if (
		!response.statusCode
		|| response.statusCode < 200
		|| response.statusCode > 299
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

const sanitizeMessage = (message: string) => message.trim().replace(/[\n\r]/g, '').replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const getBasePrompt = (
	locale: string,
	maxLength: number,
) => `${[
	'Generate a concise git commit message written in present tense for the following code diff with the given specifications below:',
	`Message language: ${locale}`,
	`Commit message must be a maximum of ${maxLength} characters.`,
	'Exclude anything unnecessary such as translation. Your entire response will be passed directly into git commit.',
].join('\n')}`;

const getCommitMessageFormatOutputExample = (type: CommitType) => `The output response must be in format:\n${getCommitMessageFormat(type)}`;

const getCommitMessageFormat = (type: CommitType) => {
	if (type === 'conventional') {
		return '<type>(<optional scope>): <commit message>';
	}

	return '<commit message>';
};

/**
 * References:
 * Commitlint:
 * https://github.com/conventional-changelog/commitlint/blob/18fbed7ea86ac0ec9d5449b4979b762ec4305a92/%40commitlint/config-conventional/index.js#L40-L100
 *
 * Conventional Changelog:
 * https://github.com/conventional-changelog/conventional-changelog/blob/d0e5d5926c8addba74bc962553dd8bcfba90e228/packages/conventional-changelog-conventionalcommits/writer-opts.js#L182-L193
 */
const getExtraContextForConventionalCommits = () => (
	`Choose a type from the type-to-description JSON below that best describes the git diff:\n${
		JSON.stringify({
			docs: 'Documentation only changes',
			style: 'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
			refactor: 'A code change that neither fixes a bug nor adds a feature',
			perf: 'A code change that improves performance',
			test: 'Adding missing tests or correcting existing tests',
			build: 'Changes that affect the build system or external dependencies',
			ci: 'Changes to our CI configuration files and scripts',
			chore: "Other changes that don't modify src or test files",
			revert: 'Reverts a previous commit',
			feat: 'A new feature',
			fix: 'A bug fix',
		}, null, 2)
	}`
);

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
	proxy?: string,
) => {
	const prompt = getBasePrompt(locale, maxLength);

	const conventionalCommitsExtraContext = type === 'conventional'
		? getExtraContextForConventionalCommits()
		: '';

	const commitMessageFormatOutputExample = getCommitMessageFormatOutputExample(type);

	const messages: ChatCompletionRequestMessage[] = [
		{
			role: 'system',
			content: `${prompt}\n${conventionalCommitsExtraContext}\n${commitMessageFormatOutputExample}`,
		},
		{
			role: 'user',
			content: diff,
		},
	];

	try {
		const completion = await createChatCompletion(
			apiKey,
			{
				model,
				messages,
				temperature: 0.7,
				top_p: 1,
				frequency_penalty: 0,
				presence_penalty: 0,
				max_tokens: 200,
				stream: false,
				n: completions,
			},
			timeout,
			proxy,
		);

		return deduplicateMessages(
			completion.choices
				.filter(choice => choice.message?.content)
				.map(choice => sanitizeMessage(choice.message!.content)),
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		throw errorAsAny;
	}
};
