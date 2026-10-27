import type { ProviderDef } from './base.js';
import { OPENCODE_GO_BASE_URL } from '../subscriptions/opencode.js';

/** Models served through the OpenAI Responses API on OpenCode Go. */
export const OPENCODE_GO_RESPONSES_MODELS = /^(gpt-|grok-|muse-spark-)/;
/** Models served through the Anthropic Messages API on OpenCode Go. */
export const OPENCODE_GO_MESSAGES_MODELS = /^(minimax-|qwen3\.)/;

export const OpenCodeGoProvider: ProviderDef = {
	name: 'opencode-go',
	displayName: 'OpenCode Go',
	subscription: 'opencode',
	hint: 'uses your OpenCode Go plan',
	baseUrl: OPENCODE_GO_BASE_URL,
	apiKeyFormat: 'sk-',
	modelsFilter: (models) =>
		models.filter((m: any) => m.id).map((m: any) => m.id),
	defaultModels: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'kimi-k3'],
	fallbackModel: 'deepseek-v4.1-flash',
	defaultTimeout: 60_000,
	requiresApiKey: true,
	cacheModels: true,
};
