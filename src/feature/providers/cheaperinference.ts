import { ProviderDef } from './base.js';

export const CheaperInferenceProvider: ProviderDef = {
	name: 'cheaperinference',
	displayName: 'Cheaper Inference',
	baseUrl: 'https://api.cheaperinference.com/v1',
	apiKeyFormat: 'ci_live_',
	modelsFilter: (models) =>
		models
			.filter((m: any) => m.id && (!m.type || m.type === 'text'))
			.map((m: any) => m.id),
	defaultModels: ['gpt-5.4-mini', 'deepseek-v4-flash', 'claude-sonnet-5'],
	requiresApiKey: true,
};
