import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { ChatCompletionRequestMessage, CreateChatCompletionRequest, CreateChatCompletionResponse } from 'openai';
import {
	TiktokenModel,
	// eslint-disable-next-line camelcase
	encoding_for_model,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';

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
	diff: string,
	maxLength: number,
) => `${[
	'Generate a concise git commit message written in present tense for the following code diff with the given specifications.',
	`Message language: ${locale}`,
	`Max message character length: ${maxLength}`,
	'Exclude anything unnecessary such as the original translation—your entire response will be passed directly into git commit.',
].join('\n')}\n\n${diff}`;

const getCommitMessageFormatPrompt = (useConventionalCommits: boolean) => {
	const commitTitleParts = [];

	if (useConventionalCommits) {
		commitTitleParts.push('<conventional commits type>(<optional scope of the change>):');
	}

	commitTitleParts.push('<commit message>');

	return commitTitleParts.join(' ');
};

const getExtraContextForConventionalCommits = () => {
	// Based on https://medium.com/neudesic-innovation/conventional-commits-a-better-way-78d6785c2e08
	const conventionalCommitTypes: Record<string, string> = {
		/*
			Commented out feat: fix: change: because they are too common and
			will cause the model to generate them too often.
		*/
		// feat: 'The commit implements a new feature for the application.',
		// fix: 'The commit fixes a defect in the application.',
		// change: 'changes the implementation of an existing feature',
		build: 'alters the build system or external dependencies of the product',
		chore: 'includes a technical or preventative maintenance task',
		ci: 'continuous integration or continuous delivery scripts or configuration files',
		deprecate: 'deprecates existing functionality',
		docs: 'changes to README files and markdown (*.md) files',
		perf: 'improve the performance of algorithms or general execution',
		remove: 'removes a feature or dependency',
		revert: 'reverts one or more commits',
		security: 'improves security',
		style: 'updates or reformats the style of the source code',
		test: 'changes to the suite of automated tests',
		refactor: 'code refactoring',
	};

	let conventionalCommitDescription = '';
	// eslint-disable-next-line guard-for-in
	for (const key in conventionalCommitTypes) {
		const value = conventionalCommitTypes[key];
		conventionalCommitDescription += `${key}: ${value}\n`;
	}

	return `Choose the primary used conventional commit type from the list below based on the git diff:\n${conventionalCommitDescription}`;
};

const generateStringFromLength = (length: number) => {
	let result = '';
	const highestTokenChar = 'z';
	for (let i = 0; i < length; i += 1) {
		result += highestTokenChar;
	}
	return result;
};

const getTokens = (prompt: string, model: TiktokenModel) => {
	const encoder = encoding_for_model(model);
	const tokens = encoder.encode(prompt).length;
	// Free the encoder to avoid possible memory leaks.
	encoder.free();
	return tokens;
};

export const generateCommitMessage = async (
	apiKey: string,
	model: TiktokenModel,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	timeout: number,
	useConventionalCommits: boolean,
	proxy?: string,
) => {
	const basePrompt = getBasePrompt(locale, diff, maxLength);

	const commitMessageFormatPrompt = getCommitMessageFormatPrompt(
		useConventionalCommits,
	);

	const conventionalCommitsExtraContext = useConventionalCommits
		? getExtraContextForConventionalCommits()
		: '';

	const completionMessages: ChatCompletionRequestMessage[] = [
		{
			role: 'system',
			content: `${basePrompt}\n${commitMessageFormatPrompt}`,
		},
		{
			role: 'assistant',
			content: conventionalCommitsExtraContext,
		},
	];

	// Padded by 5 for more room for the completion.
	const stringFromLength = generateStringFromLength(maxLength + 5);

	// The token limit is shared between the prompt and the completion.
	const maxTokens = getTokens(stringFromLength + prompt, model);

	try {
		const completion = await createChatCompletion(
			apiKey,
			{
				model,
				messages: completionMessages,
				temperature: 0.7,
				top_p: 1,
				frequency_penalty: 0,
				presence_penalty: 0,
				max_tokens: maxTokens,
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
