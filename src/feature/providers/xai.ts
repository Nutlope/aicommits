import { ProviderDef } from './base.js';

export const XAiProvider: ProviderDef = {
	name: 'xai',
	displayName: 'xAI',
	baseUrl: 'https://api.x.ai/v1',
	apiKeyFormat: 'xai-',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					m.id && (!m.type || m.type === 'chat' || m.type === 'language'),
			)
			.map((m: any) => m.id),
	defaultModels: ['grok-4.1-fast', 'grok-4-fast', 'grok-code-fast-1'],
	requiresApiKey: true,
};
