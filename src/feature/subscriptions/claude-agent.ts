import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import pkg from '../../../package.json';
import { KnownError } from '../../utils/error.js';

export type AgentGenerateOptions = {
	prompt: string;
	system: string;
	/** JSON schema (draft-07) describing the expected object. */
	schema: Record<string, unknown>;
	model?: string;
	cwd?: string;
	/** Path to the user's installed CLI. */
	binary?: string;
	timeout: number;
};

export type AgentGenerateResult = {
	output: unknown;
	text: string;
	durationMs: number;
	usage?: { inputTokens?: number; outputTokens?: number };
};

const NOT_LOGGED_IN = /not logged in|login expired/i;
const USAGE_LIMIT = /hit your .*limit|rate limit|429/i;

const isHaiku = (model: string) => /haiku/i.test(model);

export const generateWithClaudeAgent = async ({
	prompt,
	system,
	schema,
	model = 'haiku',
	cwd,
	binary,
	timeout,
}: AgentGenerateOptions): Promise<AgentGenerateResult> => {
	const startedAt = Date.now();
	const abortController = new AbortController();
	const timer = setTimeout(() => abortController.abort(), timeout);
	let result: SDKResultMessage | undefined;
	try {
		for await (const message of query({
			prompt,
			options: {
				model,
				tools: [],
				settingSources: [],
				systemPrompt: system,
				outputFormat: { type: 'json_schema', schema },
				maxTurns: 2,
				persistSession: false,
				permissionPrompts: 'none',
				...(isHaiku(model)
					? { thinking: { type: 'disabled' as const } }
					: { effort: 'low' as const }),
				abortController,
				cwd,
				env: {
					...process.env,
					CLAUDE_AGENT_SDK_CLIENT_APP: `aicommits/${pkg.version}`,
				},
				...(binary ? { pathToClaudeCodeExecutable: binary } : {}),
			},
		})) {
			if (message.type === 'result') result = message;
		}
	} catch (error) {
		if (!result) {
			if (abortController.signal.aborted) {
				throw new KnownError(`Claude Agent timed out after ${timeout}ms.`);
			}
			throw error;
		}
	} finally {
		clearTimeout(timer);
	}

	if (!result) {
		throw new KnownError('Claude Agent returned no result.');
	}
	const text =
		result.subtype === 'success' ? result.result : result.errors.join('\n');
	if (NOT_LOGGED_IN.test(text)) {
		throw new KnownError(
			'Claude is not logged in. Run `claude auth login`, then try again.'
		);
	}
	if (result.subtype !== 'success' || result.is_error) {
		if (USAGE_LIMIT.test(text)) {
			throw new KnownError(
				`Claude plan limit reached: ${text}. Try again later or switch provider with \`aicommits setup\`.`
			);
		}
		throw new KnownError(`Claude Agent failed: ${text || result.subtype}`);
	}
	if (result.structured_output === undefined) {
		throw new KnownError('Claude Agent returned no structured output.');
	}
	return {
		output: result.structured_output,
		text,
		durationMs: Date.now() - startedAt,
		usage: {
			inputTokens: result.usage?.input_tokens,
			outputTokens: result.usage?.output_tokens,
		},
	};
};
