import { expect, testSuite } from 'manten';
import { getProvider } from '../../src/feature/providers/index.js';
import type { ValidConfig } from '../../src/utils/config-types.js';

const createProvider = (
	provider: string,
	config: Partial<ValidConfig> = {}
) => getProvider({ provider, ...config } as ValidConfig)!;

export default testSuite(({ describe }) => {
	describe('providers', ({ test }) => {
		test('uses a one-minute timeout for local providers', () => {
			expect(createProvider('ollama').getRequestTimeout()).toBe(60_000);
			expect(createProvider('lmstudio').getRequestTimeout()).toBe(60_000);
		});

		test('uses a ten-second timeout for hosted providers', () => {
			expect(createProvider('openai').getRequestTimeout()).toBe(10_000);
		});

		test('uses a one-minute timeout for Together generation', () => {
			expect(createProvider('togetherai').getRequestTimeout()).toBe(60_000);
		});

		test('lists only Together serverless models', async () => {
			const originalFetch = globalThis.fetch;
			const provider = createProvider('togetherai');
			const providerDefinition = provider.getDefinition();
			const originalCacheModels = providerDefinition.cacheModels;
			const fetchCalls: string[] = [];
			providerDefinition.cacheModels = false;
			globalThis.fetch = (async (input: string | URL | Request) => {
				fetchCalls.push(String(input));
				return new Response(
					JSON.stringify([{ id: 'moonshotai/Kimi-K3', type: 'chat' }]),
					{ status: 200 }
				);
			}) as typeof fetch;

			try {
				expect(await provider.getModels()).toEqual({
					models: ['moonshotai/Kimi-K3'],
				});
			} finally {
				globalThis.fetch = originalFetch;
				providerDefinition.cacheModels = originalCacheModels;
			}

			expect(fetchCalls).toEqual([
				'https://api.together.xyz/v1/models?serverless=true',
			]);
		});

		test('highlights current fast and smart Together models', () => {
			const provider = createProvider('togetherai');
			expect(provider.getHighlightedModels()).toEqual([
				'deepseek-ai/DeepSeek-V4-Flash-0731',
				'zai-org/GLM-5.3-Flash',
				'moonshotai/Kimi-K3',
			]);
			expect(provider.getDefaultModel()).toBe(
				'deepseek-ai/DeepSeek-V4-Flash-0731'
			);
			expect(provider.getFallbackModel('moonshotai/Kimi-K3')).toBe(
				'deepseek-ai/DeepSeek-V4-Flash-0731'
			);
			expect(provider.getFallbackModel('zai-org/GLM-5.3-Flash')).toBe(
				'deepseek-ai/DeepSeek-V4-Flash-0731'
			);
			expect(
				provider.getFallbackModel('deepseek-ai/DeepSeek-V4-Flash-0731')
			).toBe('zai-org/GLM-5.3-Flash');
		});

		test('highlights the current xAI models', () => {
			expect(createProvider('xai').getHighlightedModels()).toEqual([
				'grok-4.5',
				'grok-build-0.1',
				'grok-4.3',
			]);
		});

		test('keeps non-text xAI models out of the picker', () => {
			const filter = createProvider('xai').getDefinition().modelsFilter!;
			expect(
				filter([
					{ id: 'grok-4.5' },
					{ id: 'grok-build-0.1' },
					{ id: 'grok-imagine-image' },
					{ id: 'grok-imagine-video' },
					{ id: 'grok-voice' },
				])
			).toEqual(['grok-4.5', 'grok-build-0.1']);
		});

		test('uses a one-minute timeout for custom localhost providers', () => {
			for (const baseUrl of [
				'http://localhost:8080/v1',
				'http://127.0.0.1:8080/v1',
				'http://[::1]:8080/v1',
			]) {
				expect(
					createProvider('custom', {
						OPENAI_BASE_URL: baseUrl,
					}).getRequestTimeout()
				).toBe(60_000);
			}
		});

		test('uses a ten-second timeout for remote custom providers', () => {
			expect(
				createProvider('custom', {
					OPENAI_BASE_URL: 'https://example.com/v1',
				}).getRequestTimeout()
			).toBe(10_000);
		});

		test('prefers a configured timeout over the provider default', () => {
			expect(createProvider('lmstudio').getRequestTimeout(20_000)).toBe(
				20_000
			);
		});

		test('owns generation policy at the provider seam', () => {
			expect(
				createProvider('togetherai').getGenerationPolicy('moonshotai/Kimi-K3')
			).toMatchObject({ mode: 'fallback', isLocal: false });
			expect(
				createProvider('togetherai').getGenerationPolicy(
					'Qwen/Qwen2.5-7B-Instruct-Turbo'
				)
			).toMatchObject({ mode: 'fallback', isLocal: false });
			expect(
				createProvider('togetherai').getGenerationPolicy(
					'thinkingmachines/Inkling'
				)
			).toMatchObject({
				mode: 'agentic',
				isLocal: false,
				callOptions: { maxOutputTokens: 2048 },
			});
			expect(
				createProvider('openai').getGenerationPolicy('gpt-5-mini')
			).toMatchObject({
				mode: 'agentic',
				callOptions: {
					reasoning: 'minimal',
					providerOptions: {
						openai: { reasoningEffort: 'minimal' },
					},
				},
			});
			expect(
				createProvider('openai').getGenerationPolicy('gpt-5.6-luna')
			).toMatchObject({
				mode: 'agentic',
				callOptions: { reasoning: 'none' },
			});
			expect(
				createProvider('lmstudio').getGenerationPolicy('local-tool-model')
			).toMatchObject({ mode: 'agentic', isLocal: true });
		});
	});
});
