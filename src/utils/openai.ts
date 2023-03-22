import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from 'openai';
import { KnownError } from './error.js';
import { retrieveGitmojis } from './gitmoji.js';

export type CommitMessage = {
	title: string;
	description: string;
}

const deduplicateMessages = (array: CommitMessage[]) => {
	// deduplicate array on title and description
	const seen = new Set();
	return array.filter((item) => {
		const key = `${item.title}${item.description}`;
		const duplicate = seen.has(key);
		seen.add(key);
		return !duplicate;
	});
};

const getBasePrompt = (locale: string) => `
I want you to act as the author with language ${locale} of a commit message in git.
I'll enter a git diff, and your job is to convert it into a useful commit message in the present tense.`;

const getOutputFormat = () => `
I want you to output the result in the following format:
{
	"title": "<commit title>",
	"description": "<commit description>",
}
`;

const getCommitMessageExtraContext = (locale: string) => `
The <commit title> must be in the language: ${locale}.
The <commit description> must be in the language: ${locale}.
The <commit title> should be no longer than 50 characters.
The <commit description> must be a full sentence.
`;

const getCommitTitleFormatPrompt = (useConventionalCommits: boolean, useGitmoji: boolean) => {
	const commitTitleParts = [];

	if (useConventionalCommits) {
		commitTitleParts.push('<conventional commits type>(<optional scope of the change>):');
	}

	if (useGitmoji) {
		commitTitleParts.push('<gitmoji (required)>');
	}

	commitTitleParts.push('<commit title>');

	return commitTitleParts.join(' ');
};

const getCommitMessageFormatPrompt = (useConventionalCommits: boolean, useGitmoji: boolean) => {
	const commitTitleFormat = getCommitTitleFormatPrompt(useConventionalCommits, useGitmoji);

	return `I want you to always output the result in the following format:
	{
		"title": "${commitTitleFormat}",
		"description": "<commit description>"
	}`;
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
		change: 'changes the implementation of an existing feature',
		chore: 'includes a technical or preventative maintenance task',
		ci: 'continuous integration or continuous delivery scripts or configuration files',
		deprecate: 'deprecates existing functionality',
		docs: 'add or update documentation',
		perf: 'improve the performance of algorithms or general execution',
		refactor: 'code refactoring',
		remove: 'remove a feature',
		revert: 'revert one or more commits',
		security: 'improve security',
		style: 'update or reformat the style of the source code',
		test: 'changes to the suite of automated tests',
	};

	let conventionalCommitDescription = '';
	// eslint-disable-next-line guard-for-in
	for (const key in conventionalCommitTypes) {
		const value = conventionalCommitTypes[key];
		conventionalCommitDescription += `${key}: ${value}\n`;
	}

	return `Choose a conventional commit type from the list below based on the git diff:\n${conventionalCommitDescription}`;
};

const getExtraContextGitmoji = async () => {
	try {
		const gitmojis = await retrieveGitmojis();
		let gitmojiDescriptions = '';
		for (const gitmoji of gitmojis) {
			gitmojiDescriptions += `${gitmoji.emoji}: ${gitmoji.description}\n`;
		}

		return `Choose a gitmoji from the list below based on the conventional commit scope and git diff:\n${gitmojiDescriptions}`;
	} catch {
		throw new KnownError('Error connecting to the Gitmoji API. Are you connected to the internet?');
	}
};

const model = 'gpt-3.5-turbo';

export const generateCommitMessage = async (
	apiKey: string,
	locale: string,
	diff: string,
	completions: number,
	useConventionalCommits: boolean,
	useGitmoji: boolean,
): Promise<CommitMessage[]> => {
	const basePrompt = getBasePrompt(locale);
	const commitMessageFormatPrompt = getCommitMessageFormatPrompt(
		useConventionalCommits,
		useGitmoji,
	);

	const systemPrompt = `${basePrompt} ${commitMessageFormatPrompt}`;

	const outputFormat = getOutputFormat();
	const commitMessageExtraContext = getCommitMessageExtraContext(locale);
	const conventionalCommitsExtraContext = useConventionalCommits
		? getExtraContextForConventionalCommits()
		: '';

	const gitMojiExtraContext = useGitmoji ? await getExtraContextGitmoji() : '';

	const completionMessages: ChatCompletionRequestMessage[] = [
		{
			role: 'system',
			content: systemPrompt,
		},
		{
			role: 'assistant',
			content: commitMessageExtraContext,
		},
		{
			role: 'assistant',
			content: conventionalCommitsExtraContext,
		},
		{
			role: 'assistant',
			content: gitMojiExtraContext,
		},
		{
			role: 'assistant',
			content: outputFormat,
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

		const commitMessages: CommitMessage[] = completion.data.choices
			.filter(choice => choice.message?.content)
			.map(choice => JSON.parse(choice.message!.content));

		return deduplicateMessages(commitMessages);
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
