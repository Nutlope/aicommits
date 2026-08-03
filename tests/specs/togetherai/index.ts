import { expect, testSuite } from 'manten';
import { generateCommitMessage } from '../../../src/utils/openai.js';
import type { ValidConfig } from '../../../src/utils/config-types.js';
import { getDiff } from '../../utils.js';

const { TOGETHER_API_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!TOGETHER_API_KEY) {
		console.warn(
			'⚠️  process.env.TOGETHER_API_KEY is necessary to run these tests. Skipping...',
		);
		return;
	}

	describe('Conventional Commits', async ({ test }) => {
		await test('Should generate conventional commit format', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				locale: 'en',
			});

			// Should start with conventional commit type
			expect(commitMessage).toMatch(
				/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/,
			);
			console.log('Generated message:', commitMessage);
		});

		await test('Should generate conventional commit for new feature', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// Should be in conventional commit format
			expect(commitMessage).toMatch(
				/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/,
			);
			console.log('Generated message:', commitMessage);
		});

		await test('Should generate conventional commit for refactoring', async () => {
			const gitDiff = await getDiff('code-refactoring.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// Should be in conventional commit format
			expect(commitMessage).toMatch(
				/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/,
			);
			console.log('Generated message:', commitMessage);
		});

		async function runGenerateCommitMessage(
			gitDiff: string,
			configOverrides: Partial<ValidConfig> = {},
		): Promise<string> {
			const config = {
				locale: 'en',
				type: 'conventional',
				generate: 1,
				'max-length': 72,
				...configOverrides,
			} as ValidConfig;
			const { messages: commitMessages } = await generateCommitMessage({
				baseUrl: 'https://api.together.xyz',
				apiKey: TOGETHER_API_KEY!,
				model: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
				locale: config.locale,
				diff: gitDiff,
				completions: config.generate,
				maxLength: config['max-length'],
				type: config.type,
				timeout: 7000,
			});

			return commitMessages[0];
		}
	});
});
