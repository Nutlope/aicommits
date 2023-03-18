import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { CreateChatCompletionRequest, CreateChatCompletionResponse } from 'openai';
import { encoding_for_model as encodingForModel } from '@dqbd/tiktoken';
import { KnownError } from './error.js';

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
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
			timeout: 10_000, // 10s
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
		reject(new KnownError('Request timed out'));
	});

	request.write(postContent);
	request.end();
});

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
) => {
	const { response, data } = await httpsPost(
		'api.openai.com',
		'/v1/chat/completions',
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
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

const getBasePrompt = (locale: string, diff: string) => `Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything, the response must be in the language ${locale}:\n${diff}.`;

const getCommitMessageFormatPrompt = (useConventionalCommits: boolean) => {
	const commitFormatParts = [];

	if (useConventionalCommits) {
		commitFormatParts.push('<conventional commit type>:');
	}

	commitFormatParts.push('<commit message>');

	// <conventional commit type>: <commit message>
	return `The commit message should be in the following format: ${commitFormatParts.join(' ')}.`;
};

const getExtraContextForConventionalCommits = () => {
	// Based on https://medium.com/neudesic-innovation/conventional-commits-a-better-way-78d6785c2e08
	const conventionalCommitTypes: Record<string, string> = {
		/*
			Comment out feat: and fix: because they are too common and
			will cause the model to generate them too often.
		*/
		// feat: 'The commit implements a new feature for the application.',
		// fix: 'The commit fixes a defect in the application.',
		build:
			'The commit alters the build system or external dependencies of the product (adding, removing, or upgrading dependencies).',
		change: 'The commit changes the implementation of an existing feature.',
		chore:
			'The commit includes a technical or preventative maintenance task that is necessary for managing the product or the repository, but it is not tied to any specific feature or user story. For example, releasing the product can be considered a chore. Regenerating generated code that must be included in the repository could be a chore.',
		ci: 'The commit makes changes to continuous integration or continuous delivery scripts or configuration files.',
		deprecate:
			'The commit deprecates existing functionality, but does not remove it from the product. For example, sometimes older public APIs may get deprecated because newer, more efficient APIs are available. Removing the APIs could break existing integrations so the APIs may be marked as deprecated in order to encourage the integration developers to migrate to the newer APIs while also giving them time before removing older functionality.',
		docs: 'The commit adds, updates, or revises documentation that is stored in the repository.',
		perf: 'The commit improves the performance of algorithms or general execution time of the product, but does not fundamentally change an existing feature.',
		refactor:
			'The commit refactors existing code in the product, but does not alter or change existing behavior in the product.',
		remove:
			'The commit removes a feature from the product. Typically features are deprecated first for a period of time before being removed. Removing a feature from the product may be considered a breaking change that will require a major version number increment.',
		revert:
			'The commit reverts one or more commits that were previously included in the product, but were accidentally merged or serious issues were discovered that required their removal from the main branch.',
		security:
			'The commit improves the security of the product or resolves a security issue that has been reported.',
		style:
			'The commit updates or reformats the style of the source code, but does not otherwise change the product implementation.',
		test: 'The commit enhances, adds to, revised, or otherwise changes the suite of automated tests for the product.',
	};

	const extraContextList = [];

	// eslint-disable-next-line guard-for-in
	for (const key in conventionalCommitTypes) {
		const value = conventionalCommitTypes[key];
		const context = `When ${value}, then I want you to use the "${key}" conventional commit type.`;
		extraContextList.push(context);
	}

	return extraContextList.join(' ');
};

const model = 'gpt-3.5-turbo';
// TODO: update for the new gpt-3.5 model
const encoder = encodingForModel('text-davinci-003');

export const generateCommitMessage = async (
	apiKey: string,
	locale: string,
	diff: string,
	completions: number,
	useConventionalCommits: boolean,
) => {
	const basePrompt = getBasePrompt(locale, diff);
	const commitMessageFormatPrompt = getCommitMessageFormatPrompt(useConventionalCommits);

	const conventionalCommitsExtraContext = useConventionalCommits ? getExtraContextForConventionalCommits() : '';

	const prompt = `${basePrompt} ${commitMessageFormatPrompt} ${conventionalCommitsExtraContext}`;

	/**
	 * text-davinci-003 has a token limit of 4000
	 * https://platform.openai.com/docs/models/overview#:~:text=to%20Sep%202021-,text%2Ddavinci%2D003,-Can%20do%20any
	 */
	if (encoder.encode(prompt).length > 4000) {
		throw new KnownError('The diff is too large for the OpenAI API. Try reducing the number of staged changes, or write your own commit message.');
	}

	try {
		const completion = await createChatCompletion(apiKey, {
			model,
			messages: [{
				role: 'user',
				content: prompt,
			}],
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
