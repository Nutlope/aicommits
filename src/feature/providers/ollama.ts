import { ProviderDef } from './base.js';

export const OllamaProvider: ProviderDef = {
	name: 'ollama',
	displayName: 'Ollama (local)',
	baseUrl: 'http://localhost:11434/v1',
	modelsFilter: (models) =>
		models.filter((m: any) => m.id || m.name).map((m: any) => m.id || m.name),
	defaultModels: ['qwen3.5:4b', 'llama3.2:latest'],
	requiresApiKey: false,
	cacheModels: false,
	isLocal: true,
};
