import { readFile } from 'fs/promises';
// eslint-disable-next-line unicorn/import-style
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { expect, testSuite } from 'manten';
// import { Configuration, OpenAIApi } from 'openai';
import {
	generateCommitMessage,
} from '../../../src/utils/openai.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		return;
	}

	describe('ConventionalCommits', async ({ test }) => {
		await test('Should use "test:" conventional commit when change relate to testing a React application', async () => {
			const gitDiff = await readDiffFromFile('testing-react-application.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage).toMatch(/(test(\(.*\))?):/);
		});

		await test('Should use "build:" conventional commit when change relate to github action build pipeline', async () => {
			const gitDiff = await readDiffFromFile(
				'github-action-build-pipeline.txt',
			);

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage).toMatch(/(build):/);
		});

		await test('Should use "docs:" conventional commit when change relate to documentation changes', async () => {
			const gitDiff = await readDiffFromFile('documentation-changes.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage).toMatch(/(docs):/);
		});

		await test('Should use "(fix|change):" conventional commit when change relate to fixing code', async () => {
			const gitDiff = await readDiffFromFile('fix-nullpointer-exception.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			expect(commitMessage).toMatch(/(fix):/);
		});

		async function runGenerateCommitMessage(
			gitDiff: string,
		): Promise<string> {
			const commitMessages = await generateCommitMessage(
				OPENAI_KEY!,
				'en',
				gitDiff,
				1,
				true,
			);

			return commitMessages[0];
		}

		/*
		 *	See ./README.md in order to generate diff files
		 */
		async function readDiffFromFile(filename: string): Promise<string> {
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = dirname(__filename);
			const gitDiff = await readFile(
				path.resolve(__dirname, `./diffs/${filename}`),
				'utf8',
			);
			return gitDiff;
		}
	});
});
