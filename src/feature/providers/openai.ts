import { ProviderDef } from './base.js';

const usesMinimalReasoning = (model: string) =>
	/^(?:gpt-5|gpt-5-mini|gpt-5-nano)(?:-\d{4}-\d{2}-\d{2})?$/.test(model);

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
	defaultModels: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
	requiresApiKey: true,
	agenticGeneration: {
		callOptions: (model) => {
			const reasoningEffort = usesMinimalReasoning(model)
				? 'minimal'
				: 'none';
			return {
				reasoning: reasoningEffort,
				providerOptions: { openai: { reasoningEffort } },
			};
		},
	},
};
