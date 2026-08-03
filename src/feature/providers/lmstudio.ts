import { ProviderDef } from './base.js';

export const LMStudioProvider: ProviderDef = {
	name: 'lmstudio',
	displayName: 'LM Studio (local)',
	baseUrl: 'http://localhost:1234/v1',
	modelsFilter: (models) =>
		models
			.filter((m: any) => !m.type || m.type === 'chat' || m.type === 'language')
			.map((m: any) => m.id),
	defaultModels: ['qwen/qwen3-4b-2507', 'qwen/qwen3-8b'],
	requiresApiKey: false,
};
