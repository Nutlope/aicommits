import { ProviderDef } from './base.js';

export const RequestyProvider: ProviderDef = {
	name: 'requesty',
	displayName: 'Requesty',
	baseUrl: 'https://router.requesty.ai/v1',
	modelsFilter: (models) =>
		models
			.filter((m: any) => m.id && (!m.type || m.type === 'chat'))
			.map((m: any) => m.id),
	defaultModels: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4-5'],
	requiresApiKey: true,
	headers: {
		'HTTP-Referer': 'https://github.com/nutlope/aicommits',
		'X-Title': 'aicommits',
	},
};
