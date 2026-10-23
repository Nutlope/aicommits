import { Codex } from '@openai/codex-sdk';
import { KnownError } from '../../utils/error.js';
import type {
	AgentGenerateOptions,
	AgentGenerateResult,
} from './claude-agent.js';

const AUTH_ERROR = /401|unauthorized|not logged in|missing bearer/i;

export const generateWithCodex = async ({
	prompt,
	system,
	schema,
	model = 'gpt-6-luna',
	cwd,
	binary,
	timeout,
}: AgentGenerateOptions): Promise<AgentGenerateResult> => {
	const startedAt = Date.now();
	const codex = new Codex({
		...(binary ? { codexPathOverride: binary } : {}),
		config: {
			features: { shell_tool: false, unified_exec: false },
			history: { persistence: 'none' },
		},
	});
	const thread = codex.startThread({
		model,
		modelReasoningEffort: 'low',
		sandboxMode: 'read-only',
		approvalPolicy: 'never',
		webSearchMode: 'disabled',
		workingDirectory: cwd,
		skipGitRepoCheck: true,
		threadSource: 'aicommits',
	});

	const abortController = new AbortController();
	const timer = setTimeout(() => abortController.abort(), timeout);
	let turn;
	try {
		turn = await thread.run(`${system}\n\n${prompt}`, {
			outputSchema: schema,
			signal: abortController.signal,
		});
	} catch (error) {
		if (abortController.signal.aborted) {
			throw new KnownError(`Codex timed out after ${timeout}ms.`);
		}
		const message = error instanceof Error ? error.message : String(error);
		if (AUTH_ERROR.test(message)) {
			throw new KnownError(
				'Codex is not logged in. Run `codex login`, then try again.'
			);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}

	let output: unknown;
	try {
		output = JSON.parse(turn.finalResponse);
	} catch {
		throw new KnownError('Codex returned no structured output.');
	}
	return {
		output,
		text: turn.finalResponse,
		durationMs: Date.now() - startedAt,
		usage: {
			inputTokens: turn.usage?.input_tokens,
			outputTokens: turn.usage?.output_tokens,
		},
	};
};
