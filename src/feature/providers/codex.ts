import type { ProviderDef } from './base.js';

export const CodexProvider: ProviderDef = {
	name: 'codex',
	displayName: 'Codex',
	kind: 'agent-sdk',
	subscription: 'codex',
	hint: 'uses your ChatGPT login',
	baseUrl: '',
	staticModels: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
	defaultModels: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
	fallbackModel: 'gpt-6-sol',
	defaultTimeout: 90_000,
	requiresApiKey: false,
};
