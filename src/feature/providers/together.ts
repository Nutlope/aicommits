import { ProviderDef } from './base.js';

// Failed the aicommits tool protocol or real CLI submission checks as of 2026-08-03.
// Unknown and future Together models remain agentic by default.
export const TOGETHER_NON_AGENTIC_MODELS = new Set([
	'arize-ai/qwen-2-1.5b-instruct',
	'deepcogito/cogito-v2-1-671b',
	'google/gemma-3n-E4B-it',
	'meta-llama/Llama-3.3-70B-Instruct-Turbo',
	'openai/gpt-oss-120b',
	'openai/gpt-oss-20b',
	'pearl-ai/gemma-4-31b-it',
	'Qwen/Qwen2.5-7B-Instruct-Turbo',
	'moonshotai/Kimi-K3',
]);

const TOGETHER_REASONING_ONLY_MODELS = new Set([
	'MiniMaxAI/MiniMax-M2.7',
]);

export const supportsTogetherAgenticGeneration = (model: string) =>
	!TOGETHER_NON_AGENTIC_MODELS.has(model);

export const getTogetherGenerationOptions = (model: string) => ({
	...(TOGETHER_REASONING_ONLY_MODELS.has(model)
		? {}
		: {
				reasoning: 'none' as const,
				providerOptions: {
					togetherai: { reasoning: { enabled: false } },
				},
			}),
	...(model === 'thinkingmachines/Inkling'
		? { maxOutputTokens: 2048 }
		: {}),
});

export const TogetherProvider: ProviderDef = {
	name: 'togetherai',
	displayName: 'Together AI (recommended)',
	baseUrl: 'https://api.together.xyz/v1',
	apiKeyFormat: 'tgp_',
	modelsPath: '/models?serverless=true',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					(!m.type || m.type === 'chat' || m.type === 'language') &&
					!m.id.toLowerCase().includes('vision'),
			)
			.map((m: any) => m.id),
	defaultModels: [
		'zai-org/GLM-5.3-Flash',
		'moonshotai/Kimi-K3',
	],
	fallbackModel: 'zai-org/GLM-5.3-Flash',
	defaultTimeout: 60_000,
	requiresApiKey: true,
	agenticGeneration: {
		supports: supportsTogetherAgenticGeneration,
		callOptions: getTogetherGenerationOptions,
	},
};
