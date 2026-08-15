import type { ProviderDef } from './base.js';

export const CodexProvider: ProviderDef = {
	name: 'codex',
	displayName: 'Codex CLI (uses your Codex subscription)',
	baseUrl: 'codex://cli',
	defaultModels: ['codex'],
	defaultTimeout: 120_000,
	requiresApiKey: false,
};
