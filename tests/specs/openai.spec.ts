import { readFile } from 'fs/promises';
// eslint-disable-next-line unicorn/import-style
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { testSuite, expect } from 'manten';
// import { Configuration, OpenAIApi } from 'openai';
import {
	CommitMessage,
	generateCommitMessage,
} from '../../src/utils/openai.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn(
			'⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...',
		);
		return;
	}

	async function runGenerateCommitMessage(
		gitDiff: string,
	): Promise<CommitMessage> {
		const commitMessages = await generateCommitMessage(
			OPENAI_KEY!,
			'en',
			gitDiff,
			1,
			true,
			false,
		);

		return commitMessages[0];
	}

	async function readDiffFromFile(filename: string): Promise<string> {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const gitDiff = await readFile(
			path.resolve(__dirname, `./diffs/${filename}`),
			'utf8',
		);
		return gitDiff;
	}

	describe('OpenAI', async ({ test }) => {
		await test('Should use "test:" conventional commit when change relate to testing a React application', async () => {
			const gitDiff = await readDiffFromFile('testing-react-application.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage.title).toMatch(/(test(\(.*\))?):/);
		});

		await test('Should use "build:" conventional commit when change relate to github action build pipeline', async () => {
			const gitDiff = await readDiffFromFile('github-action-build-pipeline.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage.title).toMatch(/(build):/);
		});

		await test('Should use "docs:" conventional commit when change relate to documentation changes', async () => {
			const gitDiff = await readDiffFromFile('documentation-changes.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage.title).toMatch(/(docs):/);
		});
	});

	// async function generateDiff(typeOfChanges: string): Promise<string> {
	// 	const configuration = new Configuration({
	// 		apiKey: OPENAI_KEY,
	// 	});

	// 	const openai = new OpenAIApi(configuration);

	// 	const model = 'gpt-3.5-turbo';

	// 	const systemPrompt = `
	// 		I want you to act as a git cli
	// 		I will give you the type of content and you will generate a random git diff based on that
	// 	`;

	// 	const completion = await openai.createChatCompletion({
	// 		model,
	// 		messages: [
	// 			{
	// 				role: 'system',
	// 				content: systemPrompt,
	// 			},
	// 			{
	// 				role: 'assistant',
	// 				content: 'I want you to output only the git diff',
	// 			},
	// 			{
	// 				role: 'user',
	// 				content: typeOfChanges,
	// 			},
	// 		],
	// 	});

	// 	const gitDiffMessage = completion.data.choices[0].message;

	// 	if (!gitDiffMessage) {
	// 		throw new Error('Failed to generate git diff for test');
	// 	}

	// 	return gitDiffMessage.content;
	// }
});
