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
		'Qwen/Qwen3-Coder-Next-FP8',
		'deepseek-ai/DeepSeek-V3.1',
		'Qwen/Qwen3.5-9B',
		'Qwen/Qwen3.5-397B-A17B',
	],
	requiresApiKey: true,
};
