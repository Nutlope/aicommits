import { expect, testSuite } from 'manten';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import {
	supportsTogetherAgenticGeneration,
	TogetherProvider,
	TOGETHER_NON_AGENTIC_MODELS,
} from '../../src/feature/providers/together.js';
import { getProvider } from '../../src/feature/providers/index.js';
import type { GenerationModel } from '../../src/feature/providers/base.js';
import { generateCommitMessage } from '../../src/feature/generate-commit-message.js';
import type { ValidConfig } from '../../src/utils/config-types.js';
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

const asGenerationModel = (languageModel: LanguageModel): GenerationModel => {
	const providerName =
		typeof languageModel === 'string'
			? undefined
			: languageModel.provider.split('.')[0];
	const provider = providerName
		? getProvider({ provider: providerName } as ValidConfig)
		: null;
	return {
		languageModel,
		...(provider?.getGenerationPolicy(
			typeof languageModel === 'string' ? languageModel : languageModel.modelId
		) ?? {
			mode: 'fallback' as const,
			isLocal: false,
			callOptions: {},
		}),
	};
};

export default testSuite(({ describe }) => {
	describe('generateCommitMessage', ({ test }) => {
		test('keeps unknown Together models agentic by default', () => {
			expect(supportsTogetherAgenticGeneration('future/model')).toBe(true);
			expect(
				supportsTogetherAgenticGeneration('openai/gpt-oss-20b')
			).toBe(false);
			expect(
				supportsTogetherAgenticGeneration('Qwen/Qwen2.5-7B-Instruct-Turbo')
			).toBe(false);
			expect(supportsTogetherAgenticGeneration('thinkingmachines/Inkling')).toBe(
				true
			);
			expect(TOGETHER_NON_AGENTIC_MODELS.size).toBe(8);
			expect(TogetherProvider.defaultModels).toEqual([
				'moonshotai/Kimi-K2.7-Code',
				'zai-org/GLM-5.2',
				'moonshotai/Kimi-K2.6',
				'moonshotai/Kimi-K3',
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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

		test('rejects an LM Studio diff beyond the aggregate byte budget', async () => {
			const original = `${'a'.repeat(31_000)}\n`;
			const staged = `${'b'.repeat(31_000)}\n`;
			const { fixture } = await createFixture({ 'large.txt': original });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('large.txt', staged);
			await git('add', ['large.txt']);

			const model = new MockLanguageModelV4({
				provider: 'lmstudio.chat',
				modelId: 'local-tool-model',
				doStream: toolCallStream(
					'submit-message-1',
					'submitCommitMessage',
					{ subject: 'fix: summarize a large local change', body: null }
				),
			});
			let error: unknown;

			try {
				await generateCommitMessage({
					model: asGenerationModel(model),
					cwd: fixture.path,
					files: ['large.txt'],
					type: 'conventional',
					locale: 'en',
					maxLength: 72,
					includeBody: false,
					timeout: 60_000,
				});
			} catch (caughtError) {
				error = caughtError;
			}

			expect((error as Error).message).toMatch(
				'exceeds the 30,000-byte analysis budget'
			);
			expect(model.doStreamCalls.length).toBe(0);
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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

		test('retries a transient invalid JSON response from LM Studio', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			let attempts = 0;
			const model = new MockLanguageModelV4({
				provider: 'lmstudio.chat',
				modelId: 'local-tool-model',
				doStream: async () => {
					attempts += 1;
					if (attempts === 1) {
						throw new Error('Invalid JSON response');
					}
					return toolCallStream(
						'submit-message-1',
						'submitCommitMessage',
						{ subject: 'fix: retry malformed local response', body: null }
					);
				},
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 60_000,
			});

			expect(result.message.subject).toBe(
				'fix: retry malformed local response'
			);
			expect(model.doStreamCalls.length).toBe(2);
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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

		test('retries a whitespace-only agent subject', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'moonshotai/Kimi-K3',
				doStream: [
					toolCallStream('empty-message-1', 'submitCommitMessage', {
						subject: '   ',
						body: null,
					}),
					toolCallStream('submit-message-2', 'submitCommitMessage', {
						subject: 'fix: update fixture\nignored prose',
						body: null,
					}),
				],
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
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

		test('retries an ellipsized first line in a multiline agent subject', async () => {
			const { fixture } = await createFixture({ 'file.txt': 'before\n' });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('file.txt', 'after\n');
			await git('add', ['file.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'moonshotai/Kimi-K3',
				doStream: [
					toolCallStream('clipped-message-1', 'submitCommitMessage', {
						subject: 'fix: update…\nextra prose',
						body: null,
					}),
					toolCallStream('submit-message-2', 'submitCommitMessage', {
						subject: 'fix: update fixture',
						body: null,
					}),
				],
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
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
				doGenerate: async () =>
					textGeneration('chore: summarize large diff segment'),
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
				model: asGenerationModel(model),
				cwd: fixture.path,
				files: ['large.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.steps).toBeGreaterThan(2);
			expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toMatch(
				'a'.repeat(100)
			);
			expect(JSON.stringify(model.doStreamCalls[1].prompt)).toMatch(
				'[Requested diff is'
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
				model: asGenerationModel(model),
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

		test('retries two empty one-shot responses within the request budget', async () => {
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
					textGeneration(''),
					textGeneration('fix: update fixture value'),
				],
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
				cwd: fixture.path,
				files: ['file.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('fix: update fixture value');
			expect(model.doGenerateCalls.length).toBe(3);
			await fixture.rm();
		});

		test('retries an ellipsized one-shot subject', async () => {
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
					textGeneration('fix: update...'),
					textGeneration('fix: update fixture value'),
				],
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
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
				model: asGenerationModel(model),
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
					model: asGenerationModel(model),
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
			const model = new MockLanguageModelV4({
				doGenerate: textGeneration('chore: update all fixtures'),
			});

			const result = await generateCommitMessage({
				model: asGenerationModel(model),
				cwd: fixture.path,
				files: Object.keys(initialFiles),
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			expect(result.message.subject).toBe('chore: update all fixtures');
			expect(model.doGenerateCalls.length).toBe(1);
			const chunkPrompts = JSON.stringify(model.doGenerateCalls[0].prompt);
			for (let index = 0; index < fileCount; index += 1) {
				expect(chunkPrompts).toMatch(`updated-${index}`);
			}
			await fixture.rm();
		});

		test('covers an oversized fallback diff without prefix truncation', async () => {
			const before = Array.from({ length: 2000 }, (_, index) =>
				`before-${index}-${'a'.repeat(20)}`
			).join('\n');
			const after = Array.from({ length: 2000 }, (_, index) =>
				index === 1999
					? 'AFTER-LAST-SENTINEL'
					: `after-${index}-${'b'.repeat(20)}`
			).join('\n');
			const { fixture } = await createFixture({ 'large.txt': `${before}\n` });
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('large.txt', `${after}\n`);
			await git('add', ['large.txt']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'openai/gpt-oss-20b',
				doGenerate: async () =>
					textGeneration('chore: summarize staged changes'),
			});

			await generateCommitMessage({
				model: asGenerationModel(model),
				cwd: fixture.path,
				files: ['large.txt'],
				type: 'conventional',
				locale: 'en',
				maxLength: 72,
				includeBody: false,
				timeout: 5000,
			});

			const prompts = JSON.stringify(
				model.doGenerateCalls.map(({ prompt }) => prompt)
			);
			expect(prompts).toMatch('AFTER-LAST-SENTINEL');
			expect(prompts).not.toMatch('[Diff truncated]');
			await fixture.rm();
		});

		test('rejects staged changes beyond the aggregate file budget', async () => {
			const fileCount = 101;
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
				await fixture.writeFile(`files/${index}.txt`, `after-${index}\n`);
			}
			await git('add', ['.']);
			const model = new MockLanguageModelV4({
				provider: 'togetherai.chat',
				modelId: 'openai/gpt-oss-20b',
				doGenerate: textGeneration('chore: update fixtures'),
			});
			let error: unknown;

			try {
				await generateCommitMessage({
					model: asGenerationModel(model),
					cwd: fixture.path,
					files: Object.keys(initialFiles),
					type: 'conventional',
					locale: 'en',
					maxLength: 72,
					includeBody: false,
					timeout: 5000,
				});
			} catch (caughtError) {
				error = caughtError;
			}

			expect((error as Error).message).toMatch('at most 100 staged files');
			expect(model.doGenerateCalls.length).toBe(0);
			await fixture.rm();
		});
	});
});
