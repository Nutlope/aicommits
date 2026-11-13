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

export const commitMessageSchema = (includeBody: boolean | 'optional') => ({
	type: 'object',
	properties: {
		subject: {
			type: 'string',
			description: includeBody === 'optional'
				? 'The non-empty first line of the custom commit message.'
				: 'The commit subject line, without a trailing period.',
		},
		body: {
			type: 'string',
			description: includeBody === 'optional'
				? 'Follow the custom prompt for the body and grouping; leave empty if no body is needed.'
				: includeBody
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
