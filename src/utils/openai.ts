import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from 'openai';
import { KnownError } from './error.js';

const sanitizeMessage = (message: string) => message.trim().replace(/[\n\r]/g, '').replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const getBasePrompt = (locale: string) => `
I want you to act as the author with language ${locale} of a commit message in git.
I'll enter a git diff and your job is to convert create a useful commit message based on the diff in the present tense.
`;

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
			Commented out feat: and fix: because they are too common and
			will cause the model to generate them too often.
		*/
		// feat: 'The commit implements a new feature for the application.',
		// fix: 'The commit fixes a defect in the application.',
		build: 'alters the build system or external dependencies of the product',
		chore: 'includes a technical or preventative maintenance task',
		ci: 'continuous integration or continuous delivery scripts or configuration files',
		deprecate: 'deprecates existing functionality',
		docs: 'changes to README files and markdown (*.md) files',
		perf: 'improve the performance of algorithms or general execution',
		remove: 'removes a feature or dependency',
		refactor: 'code refactoring',
		revert: 'reverts one or more commits',
		security: 'improves security',
		style: 'updates or reformats the style of the source code',
		test: 'changes to the suite of automated tests',
		change: 'changes the implementation of an existing feature',
	};

	let conventionalCommitDescription = '';
	// eslint-disable-next-line guard-for-in
	for (const key in conventionalCommitTypes) {
		const value = conventionalCommitTypes[key];
		conventionalCommitDescription += `${key}: ${value}\n`;
	}

	return `Choose the primary used conventional commit type from the list below based on the git diff:\n${conventionalCommitDescription}`;
};

const model = 'gpt-3.5-turbo';

export const generateCommitMessage = async (
	apiKey: string,
	locale: string,
	diff: string,
	completions: number,
	useConventionalCommits: boolean,
) => {
	const basePrompt = getBasePrompt(locale);

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
		{
			role: 'user',
			content: diff,
		},
	];

	const configuration = new Configuration({
		apiKey,
	});

	const openai = new OpenAIApi(configuration);

	try {
		const completion = await openai.createChatCompletion({
			model,
			messages: completionMessages,
			temperature: 0.7,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
			stream: false,
			n: completions,
		});

		return deduplicateMessages(
			completion.data.choices
				.filter(choice => choice.message?.content)
				.map(choice => sanitizeMessage(choice.message!.content)),
		);
	} catch (error: any) {
		if (error.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${error.hostname} (${error.syscall}). Are you connected to the internet?`);
		}

		const statusCode = error?.response?.status;
		if (statusCode === 400) {
			throw new KnownError(
				'The diff is too large for the OpenAI API. Try reducing the number of staged changes, or write your own commit message.',
			);
		}

		if (statusCode === 401) {
			throw new KnownError('Unauthorized: The OPENAI_KEY that you configured is invalid.');
		}
	}

	throw new Error('An unknown error occured, Please try again.');
};
