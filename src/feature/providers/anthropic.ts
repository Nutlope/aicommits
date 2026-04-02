import type { ProviderDef } from './base.js';

export const AnthropicProvider: ProviderDef = {
	name: 'anthropic',
	displayName: 'Anthropic',
	baseUrl: 'https://api.anthropic.com/v1',
	apiKeyFormat: 'sk-ant-',
	modelHeaders: (apiKey) => ({
		'x-api-key': apiKey,
		'anthropic-version': '2023-06-01',
	}),
	modelsFilter: (models) =>
		models
			.filter((m: any) => m.id && m.id.includes('claude'))
			.map((m: any) => m.id),
	defaultModels: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250115'],
	requiresApiKey: true,
};
