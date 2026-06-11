import http from 'node:http';
import { expect, testSuite } from 'manten';
import {
	generateCommitMessage,
	generateCommitDescription,
} from '../../../src/utils/openai.js';
import { KnownError } from '../../../src/utils/error.js';
import type { ValidConfig } from '../../../src/utils/config-types.js';
import { getDiff } from '../../utils.js';

const { OPENAI_API_KEY } = process.env;

const withOpenAICompatibleErrorServer = async (
	callback: (baseUrl: string) => Promise<void>
) => {
	const server = http.createServer((req, res) => {
		req.resume();
		res.writeHead(400, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				error: {
					message: 'model failed to process request',
					type: 'invalid_request_error',
				},
			})
		);
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('Unable to start test server');
	}

	try {
		await callback(`http://127.0.0.1:${address.port}/v1`);
	} finally {
		server.close();
	}
};

export default testSuite(({ describe }) => {
	describe('provider error handling', async ({ test }) => {
		await test('wraps OpenAI-compatible 400 responses as KnownError', async () => {
			let thrown: unknown;

			await withOpenAICompatibleErrorServer(async (baseUrl) => {
				try {
					await generateCommitMessage({
						baseUrl,
						apiKey: 'test-api-key',
						model: 'qwen2.5-coder-7b-instruct',
						locale: 'en',
						diff: 'diff --git a/a.txt b/a.txt\n+hello',
						completions: 1,
						maxLength: 72,
						type: 'conventional',
						timeout: 5000,
					});
				} catch (error) {
					thrown = error;
				}
			});

			expect(thrown instanceof KnownError).toBe(true);
			expect((thrown as Error).message).toMatch(
				'Provider failed to process your request'
			);
		});
	});

	if (!OPENAI_API_KEY) {
		console.warn(
			'⚠️  process.env.OPENAI_API_KEY is necessary to run these tests. Skipping...'
		);
		return;
	}

	describe('Conventional Commits', async ({ test }) => {
		await test('Should not translate conventional commit type to Japanase when locale config is set to japanese', async () => {
			const japaneseConventionalCommitPattern =
				/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.*\))?: [\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

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
			const gitDiff = await getDiff('github-action-build-pipeline.diff');

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

		async function runGenerateCommitMessage(
			gitDiff: string,
			configOverrides: Partial<ValidConfig> = {}
		): Promise<string> {
			const config = {
				locale: 'en',
				type: 'conventional',
				generate: 1,
				'max-length': 50,
				...configOverrides,
			} as ValidConfig;
			const { messages: commitMessages } = await generateCommitMessage({
				baseUrl: 'https://api.openai.com/v1',
				apiKey: OPENAI_API_KEY!,
				model: 'gpt-3.5-turbo',
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

	describe('subject+body / generateCommitDescription', async ({ test }) => {
		await test('generates a non-empty body from title and diff', async () => {
			const gitDiff = await getDiff('new-feature.diff');
			const title = 'feat: add new feature';

			const { description } = await generateCommitDescription({
				baseUrl: 'https://api.openai.com/v1',
				apiKey: OPENAI_API_KEY!,
				model: 'gpt-3.5-turbo',
				locale: 'en',
				title,
				diff: gitDiff,
				timeout: 7000,
				maxLength: 72,
			});

			expect(typeof description).toBe('string');
			expect(description.length).toBeGreaterThan(0);
		});
	});
});
