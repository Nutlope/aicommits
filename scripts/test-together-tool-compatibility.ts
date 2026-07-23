import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
	ToolLoopAgent,
	hasToolCall,
	stepCountIs,
	tool,
	type LanguageModel,
} from 'ai';
import { z } from 'zod';
import { getProvider } from '../src/feature/providers/index.js';
import { getTogetherReasoningOptions } from '../src/feature/providers/together.js';
import { getConfig } from '../src/utils/config-runtime.js';

const DEFAULT_TIMEOUT = 45_000;
const MAX_OUTPUT_TOKENS = 128;
const TEST_DIFF = [
	'diff --git a/src/greeting.ts b/src/greeting.ts',
	'index 1a2b3c4..5d6e7f8 100644',
	'--- a/src/greeting.ts',
	'+++ b/src/greeting.ts',
	'@@ -1 +1 @@',
	`-export const greeting = 'hello';`,
	`+export const greeting = 'hello world';`,
].join('\n');

type TogetherModel = {
	id: string;
	type?: string;
};

type FailureKind =
	| 'catalog_error'
	| 'duplicate_tool_calls'
	| 'first_tool_error'
	| 'continuation_error'
	| 'invalid_submission'
	| 'no_submission'
	| 'timeout'
	| 'wrong_first_tool';

type CompatibilityResult = {
	model: string;
	compatible: boolean;
	latencyMs: number;
	transport: 'generate' | 'stream';
	steps?: number;
	firstStepToolCalls?: number;
	readExecutions?: number;
	toolNames?: string[];
	subject?: string;
	failure?: FailureKind;
	error?: string;
};

const parseModelFilter = () =>
	process.env.AICOMMITS_COMPAT_MODELS
		?.split(',')
		.map((model) => model.trim())
		.filter(Boolean);

const compactError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	const errorName =
		error instanceof Error && error.name !== 'Error' ? `${error.name}: ` : '';
	return `${errorName}${message}`.replace(/\s+/g, ' ').trim().slice(0, 500);
};

const classifyError = (error: unknown): FailureKind => {
	const message = compactError(error).toLowerCase();
	if (
		message.includes('timeout') ||
		message.includes('timed out') ||
		message.includes('abort')
	) {
		return 'timeout';
	}
	if (
		message.includes('tool') ||
		message.includes('input validation') ||
		message.includes('invalid')
	) {
		return 'continuation_error';
	}
	return 'continuation_error';
};

const getServerlessChatModels = async (
	baseUrl: string,
	apiKey: string
): Promise<string[]> => {
	const response = await fetch(`${baseUrl}/models?serverless=true`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!response.ok) {
		throw new Error(
			`Together model catalog returned ${response.status}: ${await response.text()}`
		);
	}

	const models = (await response.json()) as TogetherModel[];
	return models
		.filter((model) => model.type === 'chat')
		.map((model) => model.id)
		.sort((left, right) => left.localeCompare(right));
};

const testModel = async (
	model: LanguageModel,
	modelId: string,
	timeout: number,
	transport: 'generate' | 'stream'
): Promise<CompatibilityResult> => {
	const startedAt = performance.now();
	let readExecutions = 0;
	const readStagedDiff = tool({
		description: 'Read the staged Git diff.',
		inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
		execute: async () => {
			readExecutions += 1;
			return TEST_DIFF;
		},
	});
	const submitCommitMessage = tool({
		description: 'Submit the final commit message.',
		inputSchema: z.object({
			subject: z.string().min(1).max(72),
			body: z.string().nullable(),
		}),
	});
	try {
		const agent = new ToolLoopAgent({
			model,
			instructions: [
				'Write an accurate Conventional Commit message for the staged changes.',
				'First read the staged diff. Then submit the commit message.',
				'Never answer with prose.',
			].join('\n'),
			tools: { readStagedDiff, submitCommitMessage },
			toolChoice: 'required',
			stopWhen: [hasToolCall('submitCommitMessage'), stepCountIs(2)],
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			maxRetries: 0,
			...getTogetherReasoningOptions(modelId),
			prepareStep: ({ stepNumber }) => ({
				toolChoice: {
					type: 'tool',
					toolName:
						stepNumber === 0
							? 'readStagedDiff'
							: 'submitCommitMessage',
				},
			}),
		});

		const call = {
			prompt: 'Staged files:\n- src/greeting.ts',
			timeout,
			onError: () => {},
		};
		const result =
			transport === 'stream'
				? await agent.stream(call)
				: await agent.generate(call);
		const steps = await result.steps;
		const staticToolCalls = await result.staticToolCalls;
		const toolNames = steps.flatMap((step) =>
			step.staticToolCalls.map((call) => call.toolName)
		);
		const firstStepToolCalls = steps[0]?.staticToolCalls.length ?? 0;
		const firstStepNames =
			steps[0]?.staticToolCalls.map((call) => call.toolName) ?? [];
		const submission = staticToolCalls.find(
			(call) => call.toolName === 'submitCommitMessage'
		);
		const base = {
			model: modelId,
			latencyMs: Math.round(performance.now() - startedAt),
			transport,
			steps: steps.length,
			firstStepToolCalls,
			readExecutions,
			toolNames,
		};

		if (firstStepNames.some((name) => name !== 'readStagedDiff')) {
			return { ...base, compatible: false, failure: 'wrong_first_tool' };
		}
		if (firstStepToolCalls !== 1) {
			return {
				...base,
				compatible: false,
				failure:
					firstStepToolCalls > 1
						? 'duplicate_tool_calls'
						: 'first_tool_error',
			};
		}
		if (!submission) {
			return { ...base, compatible: false, failure: 'no_submission' };
		}
		if (
			typeof submission.input.subject !== 'string' ||
			!submission.input.subject.trim()
		) {
			return { ...base, compatible: false, failure: 'invalid_submission' };
		}

		return {
			...base,
			compatible: true,
			subject: submission.input.subject.trim(),
		};
	} catch (error) {
		return {
			model: modelId,
			compatible: false,
			latencyMs: Math.round(performance.now() - startedAt),
			transport,
			readExecutions,
			failure:
				readExecutions === 0 ? 'first_tool_error' : classifyError(error),
			error: compactError(error),
		};
	}
};

const main = async () => {
	const config = await getConfig();
	const provider = getProvider(config);
	if (!provider || provider.name !== 'togetherai') {
		throw new Error('This check requires a configured Together AI provider.');
	}
	const apiKey = provider.getApiKey();
	if (!apiKey) {
		throw new Error('Together AI API key is missing.');
	}

	const catalogModels = await getServerlessChatModels(
		provider.getBaseUrl(),
		apiKey
	);
	const requestedModels = parseModelFilter();
	const models = requestedModels
		? catalogModels.filter((model) => requestedModels.includes(model))
		: catalogModels;
	const missingModels = requestedModels?.filter(
		(model) => !catalogModels.includes(model)
	);
	if (missingModels?.length) {
		throw new Error(
			`Requested models are not current serverless chat models: ${missingModels.join(', ')}`
		);
	}

	const timeout = Number(
		process.env.AICOMMITS_COMPAT_TIMEOUT || DEFAULT_TIMEOUT
	);
	const transport =
		process.env.AICOMMITS_COMPAT_STREAM === 'false' ? 'generate' : 'stream';
	const delay = Number(process.env.AICOMMITS_COMPAT_DELAY || 0);
	const results: CompatibilityResult[] = [];
	console.log(`Testing ${models.length} Together serverless chat models...`);
	for (const [index, modelId] of models.entries()) {
		process.stdout.write(`[${index + 1}/${models.length}] ${modelId} ... `);
		const result = await testModel(
			provider.getLanguageModel(modelId),
			modelId,
			timeout,
			transport
		);
		results.push(result);
		console.log(
			`${result.compatible ? 'PASS' : `FAIL (${result.failure})`} ${result.latencyMs}ms`
		);
		if (delay && index < models.length - 1) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
		}
	}

	const report = {
		testedAt: new Date().toISOString(),
		catalog: {
			endpoint: `${provider.getBaseUrl()}/models?serverless=true`,
			serverlessChatModels: catalogModels.length,
			testedModels: models.length,
		},
		protocol: {
			transport,
			firstStep: 'forced readStagedDiff tool call',
			secondStep: 'forced submitCommitMessage tool call',
			reasoning: 'disabled except for known reasoning-only models',
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			timeoutMs: timeout,
			delayMs: delay,
		},
		summary: {
			compatible: results.filter((result) => result.compatible).length,
			incompatible: results.filter((result) => !result.compatible).length,
			denylist: results
				.filter((result) => !result.compatible)
				.map((result) => result.model),
		},
		results,
	};

	const outputPath = process.env.AICOMMITS_COMPAT_OUTPUT;
	if (outputPath) {
		const absolutePath = resolve(outputPath);
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`Wrote ${absolutePath}`);
	}
	console.log(JSON.stringify(report, null, 2));
};

await main();
