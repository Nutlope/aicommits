import { expect, testSuite } from 'manten';
import {
	generateCommitMessage,
} from '../../../src/utils/openai.js';
import type { ValidConfig } from '../../../src/utils/config.js';
import { getDiff } from '../../utils.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		return;
	}

	describe('Conventional Commits', async ({ test }) => {
		await test('Should not translate conventional commit type to Japanase when locale config is set to japanese', async () => {
			const japaneseConventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.*\))?: [\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				locale: 'ja',
			});

			expect(commitMessage).toMatch(japaneseConventionalCommitPattern);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "feat:" conventional commit when change relate to adding a new feature', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "feat:" or "feat(<scope>):"
			expect(commitMessage).toMatch(/(feat(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "refactor:" conventional commit when change relate to code refactoring', async () => {
			const gitDiff = await getDiff('code-refactoring.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "refactor:" or "refactor(<scope>):"
			expect(commitMessage).toMatch(/(refactor(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "test:" conventional commit when change relate to testing a React application', async () => {
			const gitDiff = await getDiff('testing-react-application.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "test:" or "test(<scope>):"
			expect(commitMessage).toMatch(/(test(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "build:" conventional commit when change relate to github action build pipeline', async () => {
			const gitDiff = await getDiff(
				'github-action-build-pipeline.diff',
			);

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "build:" or "build(<scope>):"
			expect(commitMessage).toMatch(/((build|ci)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "(ci|build):" conventional commit when change relate to continious integration', async () => {
			const gitDiff = await getDiff('continous-integration.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "ci:" or "ci(<scope>):
			// It also sometimes generates build and feat
			expect(commitMessage).toMatch(/((ci|build|feat)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "docs:" conventional commit when change relate to documentation changes', async () => {
			const gitDiff = await getDiff('documentation-changes.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "docs:" or "docs(<scope>):"
			expect(commitMessage).toMatch(/(docs(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "fix:" conventional commit when change relate to fixing code', async () => {
			const gitDiff = await getDiff('fix-nullpointer-exception.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "fix:" or "fix(<scope>):"
			// Sometimes it generates refactor
			expect(commitMessage).toMatch(/((fix|refactor)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "style:" conventional commit when change relate to code style improvements', async () => {
			const gitDiff = await getDiff('code-style.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "style:" or "style(<style>):"
			expect(commitMessage).toMatch(/(style|refactor|fix)(\(.*\))?:/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "chore:" conventional commit when change relate to a chore or maintenance', async () => {
			const gitDiff = await getDiff('chore.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "chore:" or "chore(<style>):"
			// Sometimes it generates build|feat
			expect(commitMessage).toMatch(/((chore|build|feat)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "perf:" conventional commit when change relate to a performance improvement', async () => {
			const gitDiff = await getDiff('performance-improvement.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "perf:" or "perf(<style>):"
			// It also sometimes generates refactor:
			expect(commitMessage).toMatch(/((perf|refactor)(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		async function runGenerateCommitMessage(gitDiff: string,
			configOverrides: Partial<ValidConfig> = {}): Promise<string> {
			const config = {
				locale: 'en',
				type: 'conventional',
				generate: 1,
				'max-length': 50,
				...configOverrides,
			} as ValidConfig;
			const commitMessages = await generateCommitMessage(OPENAI_KEY!, 'gpt-3.5-turbo', config.locale, gitDiff, config.generate, config['max-length'], config.type, 7000);

			return commitMessages[0];
		}
	});
});
