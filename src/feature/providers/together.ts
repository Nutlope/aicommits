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
		'Qwen/Qwen2.5-7B-Instruct-Turbo',
		'openai/gpt-oss-120b',
		'openai/gpt-oss-20b',
	],
	requiresApiKey: true,
};
