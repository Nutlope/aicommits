import type { ProviderDef } from './base.js';

export const AnthropicProvider: ProviderDef = {
	name: 'anthropic',
	displayName: 'Anthropic (API key)',
	baseUrl: 'https://api.anthropic.com/v1',
	apiKeyFormat: 'sk-ant-',
	modelsHeaders: (apiKey) => ({
		'x-api-key': apiKey,
		'anthropic-version': '2023-06-01',
	}),
	modelsFilter: (models) =>
		models.filter((m: any) => m.id).map((m: any) => m.id),
	defaultModels: ['claude-haiku-4-5', 'claude-sonnet-5-5'],
	requiresApiKey: true,
	agenticGeneration: {},
};
