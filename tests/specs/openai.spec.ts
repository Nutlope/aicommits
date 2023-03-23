import { readFile } from 'fs/promises';
// eslint-disable-next-line unicorn/import-style
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
// import { Configuration, OpenAIApi } from 'openai';
import { describe, it, beforeEach } from 'vitest';
import {
	CommitMessage,
	generateCommitMessage,
} from '../../src/utils/openai.js';

const { OPENAI_KEY } = process.env;

// The two tests marked with concurrent will be run in parallel
describe('openai', () => {
	beforeEach(() => {
		if (!OPENAI_KEY) {
			console.warn(
				'⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...',
			);
		}
	});

	it.concurrent('Should use "test:" conventional commit when change relate to testing a React application', async ({ expect }) => {
		const gitDiff = await readDiffFromFile('testing-react-application.txt');

		const commitMessage = await runGenerateCommitMessage(gitDiff);

		expect(commitMessage.title).toMatch(/(test(\(.*\))?):/);
	});

	it.concurrent('Should use "build:" conventional commit when change relate to github action build pipeline', async ({ expect }) => {
		const gitDiff = await readDiffFromFile('github-action-build-pipeline.txt');

		const commitMessage = await runGenerateCommitMessage(gitDiff);

		expect(commitMessage.title).toMatch(/(build):/);
	});

	it.concurrent('Should use "docs:" conventional commit when change relate to documentation changes', async ({ expect }) => {
		const gitDiff = await readDiffFromFile('documentation-changes.txt');
		const commitMessage = await runGenerateCommitMessage(gitDiff);

		expect(commitMessage.title).toMatch(/(docs):/);
	});

	it.concurrent('Should use "(fix|change):" conventional commit when change relate to fixing code', async ({ expect }) => {
		const gitDiff = await readDiffFromFile('fix-nullpointer-exception.txt');
		const commitMessage = await runGenerateCommitMessage(gitDiff);

		expect(commitMessage.title).toMatch(/(fix):/);
	});

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
