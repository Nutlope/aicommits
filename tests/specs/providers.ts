import { createServer } from 'node:http';
import { expect, testSuite } from 'manten';
import { generateText } from 'ai';
import { getProvider } from '../../src/feature/providers/index.js';
import { Provider } from '../../src/feature/providers/base.js';
import { OpenCodeGoProvider } from '../../src/feature/providers/opencode-go.js';
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
				'deepseek-ai/DeepSeek-V4.1-Flash-1017',
				'zai-org/GLM-5.3',
				'reflection/Beam-1.0-501B-A23B',
			]);
			expect(provider.getDefaultModel()).toBe(
				'deepseek-ai/DeepSeek-V4.1-Flash-1017'
			);
			expect(provider.getFallbackModel('reflection/Beam-1.0-501B-A23B')).toBe(
				'deepseek-ai/DeepSeek-V4.1-Flash-1017'
			);
			expect(provider.getFallbackModel('zai-org/GLM-5.3')).toBe(
				'deepseek-ai/DeepSeek-V4.1-Flash-1017'
			);
			expect(
				provider.getFallbackModel('deepseek-ai/DeepSeek-V4.1-Flash-1017')
			).toBe('zai-org/GLM-5.3');
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

		test('routes OpenCode Go models with its required headers', async () => {
			const requests: { url: string; headers: Record<string, unknown> }[] = [];
			const server = createServer((request, response) => {
				requests.push({ url: request.url || '', headers: request.headers });
				if (request.method === 'GET') {
					response.writeHead(200, { 'Content-Type': 'application/json' });
					response.end(JSON.stringify({ data: [{ id: 'glm-5.3-flash' }] }));
					return;
				}
				response.writeHead(401, { 'Content-Type': 'application/json' });
				response.end(
					JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'test' } })
				);
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('No server address');
			const provider = new Provider(
				{
					...OpenCodeGoProvider,
					baseUrl: `http://127.0.0.1:${address.port}/zen/go/v1`,
					cacheModels: false,
				},
				{ provider: 'opencode-go', OPENAI_API_KEY: 'sk-test' } as ValidConfig
			);

			try {
				for (const model of ['glm-5.3-flash', 'gpt-6-luna', 'minimax-m3']) {
					await generateText({
						model: provider.getLanguageModel(model),
						prompt: 'Write a commit message',
						maxRetries: 0,
					}).catch(() => {});
				}
				expect(await provider.getModels()).toEqual({ models: ['glm-5.3-flash'] });
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}

			expect(requests.map(({ url }) => url)).toEqual([
				'/zen/go/v1/chat/completions',
				'/zen/go/v1/responses',
				'/zen/go/v1/messages',
				'/zen/go/v1/models',
			]);
			const sessionId = requests[0].headers['x-opencode-session'];
			expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
			for (const { headers } of requests) {
				expect(headers['x-opencode-session']).toBe(sessionId);
				expect(headers['x-opencode-client']).toBe('aicommits');
				expect(headers['user-agent']).toMatch(/^aicommits\//);
			}
			expect(requests[0].headers.authorization).toBe('Bearer sk-test');
			expect(requests[1].headers.authorization).toBe('Bearer sk-test');
			expect(requests[2].headers['x-api-key']).toBe('sk-test');
		});

		test('reads the OpenCode key from OPENCODE_API_KEY when none is configured', () => {
			const original = process.env.OPENCODE_API_KEY;
			process.env.OPENCODE_API_KEY = 'sk-from-env';
			try {
				const provider = createProvider('opencode-go');
				expect(provider.getApiKey()).toBe('sk-from-env');
				expect(provider.validateConfig().valid).toBe(true);
			} finally {
				if (original === undefined) delete process.env.OPENCODE_API_KEY;
				else process.env.OPENCODE_API_KEY = original;
			}
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
