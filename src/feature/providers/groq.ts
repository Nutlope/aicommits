import { ProviderDef } from './base.js';

export const GroqProvider: ProviderDef = {
	name: 'groq',
	displayName: 'Groq',
	baseUrl: 'https://api.groq.com/openai/v1',
	apiKeyFormat: 'gsk_',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					m.id && (!m.type || m.type === 'chat' || m.type === 'language'),
			)
			.map((m: any) => m.id),
	defaultModels: [
		'openai/gpt-oss-120b',
		'llama-3.1-8b-instant',
		'openai/gpt-oss-20b',
	],
	requiresApiKey: true,
};
