import { ProviderDef } from './base.js';

export const OllamaProvider: ProviderDef = {
	name: 'ollama',
	displayName: 'Ollama (local)',
	baseUrl: 'http://localhost:11434/v1',
	modelsFilter: (models) =>
		models.filter((m: any) => m.name).map((m: any) => m.name),
	defaultModels: ['gpt-oss:latest', 'llama3.2:latest'],
	requiresApiKey: false,
};
