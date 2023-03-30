import { readFile } from 'fs/promises';
// eslint-disable-next-line unicorn/import-style
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { expect, testSuite } from 'manten';
import {
	generateCommitMessage,
} from '../../../src/utils/openai.js';
import { ValidConfig } from '../../../src/utils/config.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		return;
	}

	describe('ConventionalCommits', async ({ test }) => {
		await test('Should not translate conventional commit type to Japanase when locale config is set to japanese', async () => {
			const japaneseConventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.*\))?: [\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

			const gitDiff = await readDiffFromFile('new-feature.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				locale: 'ja',
			});

			expect(commitMessage).toMatch(japaneseConventionalCommitPattern);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "feat:" conventional commit when change relate to adding a new feature', async () => {
			const gitDiff = await readDiffFromFile('new-feature.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "feat:" or "feat(<scope>):"
			expect(commitMessage).toMatch(/(feat(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "refactor:" conventional commit when change relate to code refactoring', async () => {
			const gitDiff = await readDiffFromFile('code-refactoring.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "refactor:" or "refactor(<scope>):"
			expect(commitMessage).toMatch(/(refactor(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "test:" conventional commit when change relate to testing a React application', async () => {
			const gitDiff = await readDiffFromFile('testing-react-application.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "test:" or "test(<scope>):"
			expect(commitMessage).toMatch(/(test(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "build:" conventional commit when change relate to github action build pipeline', async () => {
			const gitDiff = await readDiffFromFile(
				'github-action-build-pipeline.txt',
			);

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "build:" or "build(<scope>):"
			expect(commitMessage).toMatch(/(build(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "(ci|build):" conventional commit when change relate to continious integration', async () => {
			const gitDiff = await readDiffFromFile('continous-integration.txt');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "ci:" or "ci(<scope>):"
			expect(commitMessage).toMatch(/((ci|build)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "docs:" conventional commit when change relate to documentation changes', async () => {
			const gitDiff = await readDiffFromFile('documentation-changes.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "docs:" or "docs(<scope>):"
			expect(commitMessage).toMatch(/(docs(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "fix:" conventional commit when change relate to fixing code', async () => {
			const gitDiff = await readDiffFromFile('fix-nullpointer-exception.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "fix:" or "fix(<scope>):"
			expect(commitMessage).toMatch(/(fix(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "remove:" conventional commit when change relate to removing code', async () => {
			const gitDiff = await readDiffFromFile('remove-feature.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "remove:" or "fix(<remove>):"
			expect(commitMessage).toMatch(/(remove(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "deprecate:" conventional commit when change relate to removing code', async () => {
			const gitDiff = await readDiffFromFile('deprecate-feature.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "deprecate:" or "deprecate(<scope>):"
			expect(commitMessage).toMatch(/(deprecate(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "style:" conventional commit when change relate to code style improvements', async () => {
			const gitDiff = await readDiffFromFile('code-style.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "style:" or "style(<style>):"
			expect(commitMessage).toMatch(/(style(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "chore:" conventional commit when change relate to a chore or maintenance', async () => {
			const gitDiff = await readDiffFromFile('chore.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "chore:" or "chore(<style>):"
			expect(commitMessage).toMatch(/(chore(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "perf:" conventional commit when change relate to a performance improvement', async () => {
			const gitDiff = await readDiffFromFile('performance-improvement.txt');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "perf:" or "perf(<style>):"
			expect(commitMessage).toMatch(/(perf(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		async function runGenerateCommitMessage(gitDiff: string,
			configOverrides: Partial<ValidConfig> = {}): Promise<string> {
			const config = {
				locale: 'en',
				conventional: true,
				generate: 1,
				...configOverrides,
			} as ValidConfig;
			// eslint-disable-next-line max-len
			const commitMessages = await generateCommitMessage(OPENAI_KEY!, config.locale, gitDiff, config.generate, config.conventional);

			return commitMessages[0];
		}

		/*
		 *	See ./diffs/README.md in order to generate diff files
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