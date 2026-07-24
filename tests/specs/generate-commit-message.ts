import { expect, testSuite } from 'manten';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import {
	supportsTogetherAgenticGeneration,
	TogetherProvider,
	TOGETHER_NON_AGENTIC_MODELS,
} from '../../src/feature/providers/together.js';
import { generateCommitMessage } from '../../src/utils/generate-commit-message.js';
import { createFixture, createGit } from '../utils.js';

const usage = {
	inputTokens: {
		total: 10,
		noCache: 10,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: {
		total: 10,
		text: 10,
		reasoning: undefined,
	},
};

const toolCallStream = (
	toolCallId: string,
	toolName: string,
	input: Record<string, unknown>
) => ({
	stream: simulateReadableStream({
		chunks: [
			{ type: 'stream-start' as const, warnings: [] },
			{
				type: 'tool-call' as const,
				toolCallId,
				toolName,
				input: JSON.stringify(input),
			},
			{
				type: 'finish' as const,
				finishReason: { unified: 'tool-calls' as const, raw: undefined },
				usage,
			},
		],
	}),
});

const textGeneration = (text: string) => ({
	content: [{ type: 'text' as const, text }],
	finishReason: { unified: 'stop' as const, raw: undefined },
	usage,
	warnings: [],
});

const emptyStream = () => ({
	stream: simulateReadableStream({
		chunks: [
			{ type: 'stream-start' as const, warnings: [] },
			{
				type: 'finish' as const,
				finishReason: { unified: 'stop' as const, raw: undefined },
				usage,
			},
		],
	}),
});

export default testSuite(({ describe }) => {
	describe('generateCommitMessage', ({ test }) => {
		test('keeps unknown Together models agentic by default', () => {
			expect(supportsTogetherAgenticGeneration('future/model')).toBe(true);
			expect(
				supportsTogetherAgenticGeneration('openai/gpt-oss-20b')
			).toBe(false);
			expect(TOGETHER_NON_AGENTIC_MODELS.size).toBe(7);
			expect(TogetherProvider.defaultModels).toEqual([
				'moonshotai/Kimi-K2.7-Code',
				'zai-org/GLM-5.2',
				'moonshotai/Kimi-K2.6',
				'MiniMaxAI/MiniMax-M2.7',
			]);
		});

		test('submits a small staged diff in one model call', async () => {
			const { fixture } = await createFixture({
				'src/greeting.ts': `export const greeting = 'hello';\n`,
			});
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);

			await fixture.writeFile(
				'src/greeting.ts',
				`export const greeting = 'staged greeting';\n`
			);
			await git('add', ['src/greeting.ts']);
			await fixture.writeFile(
				'src/greeting.ts',
				`export const greeting = 'unstaged secret';\n`
			);

			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'moonshotai/Kimi-K2.7-Code',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{
						subject: 'feat: update staged greeting',
						body: null,
					}
				),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['src/greeting.ts'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message).toEqual({
				subject: 'feat: update staged greeting',
			});
			expect(result.steps).toBe(1);

			const finalPrompt = JSON.stringify(model.doStreamCalls[0].prompt);
			expect(finalPrompt).toMatch('staged greeting');
			expect(finalPrompt).not.toMatch('unstaged secret');
			expect(model.doStreamCalls[0].toolChoice).toEqual({
				type: 'required',
			});
			expect(model.doStreamCalls[0].reasoning).toBe('none');
			expect(model.doStreamCalls[0].providerOptions).toEqual({
				togetherai: { reasoning: { enabled: false } },
			});
			expect(model.doStreamCalls[0].responseFormat).toBeUndefined();
			expect(finalPrompt).toMatch(
				'Use refactor for internal restructuring and chore for maintenance'
			);
			expect(finalPrompt).toMatch(
				'Never mark a commit as breaking unless the staged changes clearly break'
			);

			await fixture.rm();
		});

		test('uses agentic generation for OpenAI models with reasoning disabled', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'openai.responses',
				modelId: 'gpt-5.6-luna',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{ subject: 'fix: update fixture', body: null }
				),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(1);
			expect(model.doGenerateCalls.length).toBe(0);
			expect(model.doStreamCalls[0].reasoning).toBe('none');
			expect(model.doStreamCalls[0].providerOptions).toEqual({
				openai: { reasoningEffort: 'none' },
			});
			await fixture.rm();
		});

		test('uses agentic generation for xAI models at their lowest reasoning level', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'xai.chat',
				modelId: 'grok-4.5',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{ subject: 'fix: update fixture', body: null }
				),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(1);
			expect(model.doGenerateCalls.length).toBe(0);
			expect(model.doStreamCalls[0].reasoning).toBe('low');
			expect(model.doStreamCalls[0].providerOptions).toEqual({
				xai: { reasoningEffort: 'low' },
			});
			await fixture.rm();
		});

		test('uses agentic generation for LM Studio models that support tools', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'lmstudio.chat',
				modelId: 'local-tool-model',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{ subject: 'fix: update fixture', body: null }
				),
				doGenerate: textGeneration('fix: incomplete one-shot result'),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(1);
			expect(model.doGenerateCalls.length).toBe(0);
			await fixture.rm();
		});

		test('keeps LM Studio tool choice compatible through the final agent step', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'lmstudio.chat',
				modelId: 'local-tool-model',
				doStream: [
					toolCallStream('read-diff-1', 'readStagedDiff', {
						paths: ['file.txt'],
					}),
					toolCallStream('read-diff-2', 'readStagedDiff', {
						paths: ['file.txt'],
					}),
					toolCallStream('read-diff-3', 'readStagedDiff', {
						paths: ['file.txt'],
					}),
					toolCallStream(
						'submit-message-1',
						'submitCommitMessage',
						{ subject: 'fix: update fixture', body: null }
					),
				],
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(4);
			expect(
				model.doStreamCalls.every(
					(call) => call.toolChoice?.type === 'required'
				)
			).toBe(true);
			await fixture.rm();
		});

		test('falls back to one-shot when a provider rejects tool calling', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'xai.chat',
				modelId: 'legacy-grok',
				doStream: async () => {
					throw new Error('This model does not support tools.');
				},
				doGenerate: textGeneration('fix: update fixture'),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(1);
			expect(model.doGenerateCalls.length).toBe(1);
			await fixture.rm();
		});

		test('falls back when an LM Studio model does not submit the required tool', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'lmstudio.chat',
				modelId: 'local-text-model',
				doStream: [emptyStream(), emptyStream()],
				doGenerate: textGeneration('fix: update fixture'),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(2);
			expect(model.doGenerateCalls.length).toBe(1);
			await fixture.rm();
		});

		test('accepts a complete agent subject beyond the preferred length', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const subject =
				'refactor(provider): replace URL support checks with structured metadata';
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'moonshotai/Kimi-K2.7-Code',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{ subject, body: null }
				),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 50,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe(subject);
			await fixture.rm();
		});

		test('accepts an empty body when no description is requested', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'MiniMaxAI/MiniMax-M3',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{
						subject: 'fix: update fixture',
						body: '',
					}
				),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			await fixture.rm();
		});

		test('retries once when an agent does not submit a valid message', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'Qwen/Qwen3.5-9B',
				doStream: [
					toolCallStream(
						'invalid-submit-message-1',
						'submitCommitMessage',
						{
							subject: 'fix: update fixture',
							body: 42,
						}
					),
					toolCallStream(
						'submit-message-2',
						'submitCommitMessage',
						{
							subject: 'fix: update fixture',
							body: null,
						}
					),
				],
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture');
			expect(model.doStreamCalls.length).toBe(2);
			await fixture.rm();
		});

		test('keeps the same tools while inspecting a large staged diff', async () => {
			const original = `${'a'.repeat(31_000)}\n`;
			const staged = `${'b'.repeat(31_000)}\n`;
			const { fixture } = await createFixture({ 'large.txt': original });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('large.txt', staged);
			await git('add', ['large.txt']);

			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'future/tool-model',
				doStream: [
					toolCallStream('read-diff-1', 'readStagedDiff', {
						paths: ['large.txt'],
					}),
					toolCallStream('submit-message-1', 'submitCommitMessage', {
						subject: 'chore: update large fixture',
						body: null,
					}),
				],
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['large.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.steps).toBe(2);
			expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toMatch(
				'a'.repeat(100)
			);
			expect(JSON.stringify(model.doStreamCalls[1].prompt)).toMatch(
				'[Diff truncated]'
			);
			expect(model.doStreamCalls[0].tools).toEqual(
				model.doStreamCalls[1].tools
			);

			await fixture.rm();
		});

		test('uses one-shot generation for denylisted Together models', async () => {
			const { fixture } = await createFixture({
				'file.txt': 'before\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);

			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'openai/gpt-oss-20b',
				doGenerate: textGeneration('fix: update fixture value'),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture value');
			expect(model.doGenerateCalls.length).toBe(1);
			expect(model.doStreamCalls.length).toBe(0);
			expect(model.doGenerateCalls[0].tools).toBeUndefined();
			expect(model.doGenerateCalls[0].reasoning).toBeUndefined();
			expect(model.doGenerateCalls[0].providerOptions).toBeUndefined();
			await fixture.rm();
		});

		test('retries an empty one-shot response once', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'openai/gpt-oss-20b',
				doGenerate: [
					textGeneration(''),
					textGeneration('fix: update fixture value'),
				],
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture value');
			expect(model.doGenerateCalls.length).toBe(2);
			await fixture.rm();
		});

		test('keeps a complete one-shot subject beyond the preferred length', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const subject =
				'refactor(provider): replace URL support checks with structured metadata';
			const model = new MockLanguageModelV4({
				doGenerate: textGeneration(subject),
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 50,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe(subject);
			await fixture.rm();
		});

		test('requires a description when one is requested', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				doGenerate: textGeneration('fix: update fixture value'),
			});

			let error: unknown;
			try {
				await generateCommitMessage({
					model,
					cwd: fixture.path,
					files: ['file.txt'],
					type: 'conventional',
					locale: 'en',
					maxLength: 72,
					includeBody: true,
					timeout: 5000,
				});
			} catch (caughtError) {
				error = caughtError;
			}

			expect((error as Error).message).toMatch(
				'did not generate a commit message description'
			);
			await fixture.rm();
		});

		test('covers every file in large one-shot fallback commits', async () => {
			const fileCount = 51;
			const initialFiles = Object.fromEntries(
				Array.from({ length: fileCount }, (_, index) => [
					`files/${index}.txt`,
					`before-${index}\n`,
				])
			);
			const { fixture } = await createFixture(initialFiles);
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			for (let index = 0; index < fileCount; index += 1) {
				await fixture.writeFile(`files/${index}.txt`, `updated-${index}\n`);
			}
			await git('add', ['.']);
			const chunkCount = Math.ceil(fileCount / 10);
			const model = new MockLanguageModelV4({
				doGenerate: [
					...Array.from({ length: chunkCount }, (_, index) =>
						textGeneration(`chore: summarize chunk ${index + 1}`)
					),
					textGeneration('chore: update all fixtures'),
				],
			});

			const result = await generateCommitMessage({
				model,
				cwd: fixture.path,
				files: Object.keys(initialFiles),
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('chore: update all fixtures');
			expect(model.doGenerateCalls.length).toBe(chunkCount + 1);
			const chunkPrompts = JSON.stringify(
				model.doGenerateCalls.slice(0, chunkCount).map(({ prompt }) => prompt)
			);
			for (let index = 0; index < fileCount; index += 1) {
				expect(chunkPrompts).toMatch(`updated-${index}`);
			}
			expect(
				JSON.stringify(model.doGenerateCalls[chunkCount].prompt)
			).toMatch('summarize chunk 6');
			await fixture.rm();
		});
	});
});
