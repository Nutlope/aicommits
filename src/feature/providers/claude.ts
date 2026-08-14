import type { ProviderDef } from './base.js';

export const ClaudeProvider: ProviderDef = {
	name: 'claude',
	displayName: 'Claude CLI (uses your Claude subscription)',
	baseUrl: 'claude://cli',
	defaultModels: ['claude'],
	defaultTimeout: 120_000,
	requiresApiKey: false,
};
