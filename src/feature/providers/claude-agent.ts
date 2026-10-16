import type { ProviderDef } from './base.js';

export const ClaudeAgentProvider: ProviderDef = {
	name: 'claude-agent',
	displayName: 'Claude Agent',
	kind: 'agent-sdk',
	subscription: 'claude',
	hint: 'uses your Claude login',
	baseUrl: '',
	staticModels: ['haiku', 'sonnet', 'opus'],
	defaultModels: ['haiku', 'sonnet', 'opus'],
	fallbackModel: 'sonnet',
	defaultTimeout: 90_000,
	requiresApiKey: false,
};
