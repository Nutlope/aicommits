import { ProviderDef } from './base.js';

const getReasoningOptions = (model: string) => {
	if (model.startsWith('grok-4.5')) {
		return {
			reasoning: 'low' as const,
			providerOptions: { xai: { reasoningEffort: 'low' } },
		};
	}
	if (model.startsWith('grok-4.3')) {
		return {
			reasoning: 'none' as const,
			providerOptions: { xai: { reasoningEffort: 'none' } },
		};
	}
	return {};
};

export const XAiProvider: ProviderDef = {
	name: 'xai',
	displayName: 'xAI',
	baseUrl: 'https://api.x.ai/v1',
	apiKeyFormat: 'xai-',
	modelsFilter: (models) =>
		models
			.filter((m: any) => {
				const id = m.id?.toLowerCase();
				return (
					id &&
					(!m.type || m.type === 'chat' || m.type === 'language') &&
					!id.includes('imagine') &&
					!id.includes('image') &&
					!id.includes('video') &&
					!id.includes('voice')
				);
			})
			.map((m: any) => m.id),
	defaultModels: ['grok-4.5', 'grok-build-0.1', 'grok-4.3'],
	requiresApiKey: true,
	agenticGeneration: { callOptions: getReasoningOptions },
};
