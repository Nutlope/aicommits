import type { SubscriptionId } from './detect.js';
import {
	generateWithClaudeAgent,
	type AgentGenerateOptions,
	type AgentGenerateResult,
} from './claude-agent.js';
import { generateWithCodex } from './codex-agent.js';

export type { AgentGenerateOptions, AgentGenerateResult };

export const generateWithAgentSdk = (
	id: SubscriptionId,
	options: AgentGenerateOptions
) =>
	id === 'claude'
		? generateWithClaudeAgent(options)
		: generateWithCodex(options);

export const commitMessageSchema = (includeBody: boolean) => ({
	type: 'object',
	properties: {
		subject: {
			type: 'string',
			description: 'The commit subject line, without a trailing period.',
		},
		body: {
			type: 'string',
			description: includeBody
				? 'A concise, non-empty commit body.'
				: 'Leave empty.',
		},
	},
	// OpenAI strict schemas require every property; an empty body means none.
	required: ['subject', 'body'],
	additionalProperties: false,
});

export const plainTextSchema = {
	type: 'object',
	properties: {
		text: { type: 'string', description: 'The requested text.' },
	},
	required: ['text'],
	additionalProperties: false,
};
