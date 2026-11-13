import { Codex, type Usage } from '@openai/codex-sdk';
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
	onProgress,
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
	let finalResponse = '';
	let usage: Usage | undefined;
	try {
		const { events } = await thread.runStreamed(`${system}\n\n${prompt}`, {
			outputSchema: schema,
			signal: abortController.signal,
		});
		for await (const event of events) {
			if (event.type === 'turn.failed') throw new Error(event.error.message);
			if (event.type === 'error') throw new Error(event.message);
			if (event.type === 'turn.completed') usage = event.usage;
			if (
				event.type === 'item.started' ||
				event.type === 'item.updated' ||
				event.type === 'item.completed'
			) {
				if (event.item.type === 'agent_message') {
					if (event.item.text) onProgress?.({ stage: 'receiving' });
					if (event.type === 'item.completed') finalResponse = event.item.text;
				} else if (event.item.type === 'reasoning') {
					onProgress?.({ stage: 'thinking' });
				} else {
					onProgress?.({ stage: 'tool' });
				}
			}
		}
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
		output = JSON.parse(finalResponse);
	} catch {
		throw new KnownError('Codex returned no structured output.');
	}
	return {
		output,
		text: finalResponse,
		durationMs: Date.now() - startedAt,
		usage: {
			inputTokens: usage?.input_tokens,
			outputTokens: usage?.output_tokens,
		},
	};
};
