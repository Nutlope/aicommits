import { ProviderDef } from './base.js';

export const OpenAiProvider: ProviderDef = {
	name: 'openai',
	displayName: 'OpenAI',
	baseUrl: 'https://api.openai.com/v1',
	apiKeyFormat: 'sk-',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					m.id &&
					(m.id.includes('gpt') ||
						m.id.includes('o1') ||
						m.id.includes('o3') ||
						m.id.includes('o4') ||
						m.id.includes('o5') ||
						!m.type ||
						m.type === 'chat')
			)
			.map((m: any) => m.id),
	defaultModels: ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-5-nano'],
	requiresApiKey: true,
};
