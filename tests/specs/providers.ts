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
	});
});
