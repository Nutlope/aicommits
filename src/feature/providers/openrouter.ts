import { ProviderDef } from './base.js';

export const OpenRouterProvider: ProviderDef = {
	name: 'openrouter',
	displayName: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	apiKeyFormat: 'sk-or-v1-',
	modelsFilter: (models) =>
		models
			.filter((m: any) => m.id && (!m.type || m.type === 'chat'))
			.map((m: any) => m.id),
	defaultModels: ['openrouter/free', 'openrouter/auto'],
	requiresApiKey: true,
	headers: {
		'HTTP-Referer': 'https://github.com/nutlope/aicommits',
		'X-Title': 'aicommits',
	},
};
