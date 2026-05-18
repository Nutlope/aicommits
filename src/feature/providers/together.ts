import { ProviderDef } from './base.js';

export const TogetherProvider: ProviderDef = {
	name: 'togetherai',
	displayName: 'Together AI (recommended)',
	baseUrl: 'https://api.together.xyz/v1',
	apiKeyFormat: 'tgp_',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					(!m.type || m.type === 'chat' || m.type === 'language') &&
					!m.id.toLowerCase().includes('vision'),
			)
			.map((m: any) => m.id),
	defaultModels: [
		'openai/gpt-oss-120b',
		'Qwen/Qwen3-Next-80B-A3B-Instruct',
		'zai-org/GLM-4.5-Air-FP8',
		'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
	],
	requiresApiKey: true,
};
