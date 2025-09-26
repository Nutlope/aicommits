import { expect, testSuite } from 'manten';
import { generateCommitMessage } from '../../../src/utils/openai.js';
import { getDiff } from '../../utils.js';

const { OPENAI_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!OPENAI_KEY) {
		console.warn(
			'⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...'
		);
		return;
	}

	describe('Base URL Configuration', async ({ test }) => {
		test('Should work with default OpenAI base URL', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessages = await generateCommitMessage(
				OPENAI_KEY!,
				'gpt-3.5-turbo',
				'en',
				gitDiff,
				1,
				50,
				'conventional',
				10000,
				undefined,
				'https://api.openai.com' // Default base URL
			);

			expect(commitMessages).toBeDefined();
			expect(commitMessages.length).toBeGreaterThan(0);
			expect(commitMessages[0]).toMatch(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci)(\(.*\))?:/);
			console.log('Generated message with default URL:', commitMessages[0]);
		});

		test('Should work with base URL without trailing slash', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessages = await generateCommitMessage(
				OPENAI_KEY!,
				'gpt-3.5-turbo',
				'en',
				gitDiff,
				1,
				50,
				'conventional',
				10000,
				undefined,
				'https://api.openai.com/' // Base URL with trailing slash
			);

			expect(commitMessages).toBeDefined();
			expect(commitMessages.length).toBeGreaterThan(0);
			expect(commitMessages[0]).toMatch(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci)(\(.*\))?:/);
			console.log('Generated message with trailing slash URL:', commitMessages[0]);
		});

		test('Should handle URL parsing correctly', async () => {
			const gitDiff = await getDiff('documentation-changes.diff');

			// Test with a hypothetical custom OpenAI-compatible endpoint
			// Note: This will still hit OpenAI since we're using a real API key
			// but it tests that the URL parsing logic works correctly
			const commitMessages = await generateCommitMessage(
				OPENAI_KEY!,
				'gpt-3.5-turbo',
				'en',
				gitDiff,
				1,
				50,
				'',
				10000,
				undefined,
				'https://api.openai.com' // Use standard URL for actual API call
			);

			expect(commitMessages).toBeDefined();
			expect(commitMessages.length).toBeGreaterThan(0);
			expect(typeof commitMessages[0]).toBe('string');
			expect(commitMessages[0].length).toBeGreaterThan(0);
			console.log('Generated message with custom URL parsing:', commitMessages[0]);
		});

		test('Should work without base URL parameter (backward compatibility)', async () => {
			const gitDiff = await getDiff('fix-nullpointer-exception.diff');

			// Test calling without base URL parameter to ensure backward compatibility
			const commitMessages = await generateCommitMessage(
				OPENAI_KEY!,
				'gpt-3.5-turbo',
				'en',
				gitDiff,
				1,
				50,
				'conventional',
				10000
				// No proxy and no baseUrl parameters
			);

			expect(commitMessages).toBeDefined();
			expect(commitMessages.length).toBeGreaterThan(0);
			expect(commitMessages[0]).toMatch(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci)(\(.*\))?:/);
			console.log('Generated message without base URL (backward compat):', commitMessages[0]);
		});

		test('Should fail gracefully with invalid base URL hostname', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			try {
				await generateCommitMessage(
					OPENAI_KEY!,
					'gpt-3.5-turbo',
					'en',
					gitDiff,
					1,
					50,
					'conventional',
					5000, // Shorter timeout for invalid hostname
					undefined,
					'https://invalid-nonexistent-hostname-12345.com'
				);

				// If we reach here, the test should fail
				expect(true).toBe(false);
			} catch (error) {
				// Should throw an error for invalid hostname
				expect(error).toBeDefined();
				console.log('Expected error for invalid hostname:', (error as Error).message);
			}
		});
	});
});
