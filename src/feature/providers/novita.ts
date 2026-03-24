import { ProviderDef } from './base.js';

export const NovitaProvider: ProviderDef = {
	name: 'novita',
	displayName: 'Novita AI',
	baseUrl: 'https://api.novita.ai/openai/v1',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					m.id && (!m.type || m.type === 'chat' || m.type === 'language'),
			)
			.map((m: any) => m.id),
	defaultModels: [
		'moonshotai/kimi-k2.5',
		'zai-org/glm-5',
		'minimax/minimax-m2.5',
	],
	requiresApiKey: true,
};