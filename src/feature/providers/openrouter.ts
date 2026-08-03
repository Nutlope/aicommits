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
	defaultModels: ['openai/gpt-oss-20b:free', 'z-ai/glm-4.5-air:free'],
	requiresApiKey: true,
	headers: {
		'HTTP-Referer': 'https://github.com/nutlope/aicommits',
		'X-Title': 'aicommits',
	},
};
