import { testSuite, expect } from 'manten';
import { Configuration, OpenAIApi } from 'openai';
import { CommitMessage, generateCommitMessage } from '../../src/utils/openai.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		return;
	}

	const configuration = new Configuration({
		apiKey: OPENAI_KEY,
	});

	const openai = new OpenAIApi(configuration);

	const model = 'gpt-3.5-turbo';

	async function gitDiffGenerator(typeOfChanges: string): Promise<string> {
		const systemPrompt = `
			I want you to act as a git cli
			I will give you the type of content and you will generate a random git diff based on that
		`;

		const completion = await openai.createChatCompletion({
			model,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'assistant',
					content: 'I want you to output only the git diff',
				},
				{
					role: 'user',
					content: typeOfChanges,
				},
			],
		});

		const gitDiffMessage = completion.data.choices[0].message;

		if (!gitDiffMessage) {
			throw new Error('Failed to generate git diff for test');
		}

		return gitDiffMessage.content;
	}

	async function runGenerateCommitMessage(gitDiff: string)
		: Promise<CommitMessage> {
		const commitMessages = await generateCommitMessage(OPENAI_KEY!, 'en', gitDiff, 1, true, false);
		return commitMessages[0];
	}

	describe('OpenAI', async ({ test }) => {
		await test('Testing a React application', async () => {
			const gitDiff = await gitDiffGenerator('Testing a React application');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage.title).toMatch(/(test):/);
		});
	});
});
