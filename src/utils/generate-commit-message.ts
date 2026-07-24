import {
	ToolLoopAgent,
	generateText,
	hasToolCall,
	stepCountIs,
	tool,
	type JSONValue,
	type LanguageModel,
	type LanguageModelCallOptions,
	type LanguageModelUsage,
} from 'ai';
import { execa } from 'execa';
import { z } from 'zod';
import {
	getTogetherReasoningOptions,
	supportsTogetherAgenticGeneration,
} from '../feature/providers/together.js';
import type { CommitType } from './config-types.js';
import { isToolUnsupportedError } from './error.js';

const MAX_DIFF_LENGTH = 30_000;
const MAX_AGENT_STEPS = 4;
const MAX_NON_AGENTIC_FILES = 50;
const NON_AGENTIC_CHUNK_SIZE = 10;
const AGENT_ATTEMPTS = 2;
const ONE_SHOT_ATTEMPTS = 2;

export type CommitMessage = {
	subject: string;
	body?: string;
};

export type GenerateCommitMessageOptions = {
	model: LanguageModel;
	cwd: string;
	files: string[];
	type: CommitType;
	locale: string;
	maxLength: number;
	includeBody: boolean;
	timeout: number;
	customPrompt?: string;
};

const formats: Record<CommitType, string> = {
	plain: 'plain text',
	conventional: 'Conventional Commits: <type>(optional scope): <subject>',
	gitmoji: 'Gitmoji: <emoji> <subject>',
};

type CommitInstructionOptions = Pick<
	GenerateCommitMessageOptions,
	'type' | 'locale' | 'maxLength' | 'includeBody' | 'customPrompt'
>;

const buildCommitInstructions = (
	{
		type,
		locale,
		maxLength,
		includeBody,
		customPrompt,
	}: CommitInstructionOptions,
	pathInstructions: Array<string | undefined>
) =>
	[
		'Write an accurate Git commit message for the staged changes.',
		...pathInstructions,
		'Mention the important behavior change, not file names.',
		`Write in ${locale}. Format: ${formats[type]}.`,
		type === 'conventional'
			? [
					'Use fix for corrected behavior and feat only for a new user-facing capability.',
					'Use refactor for internal restructuring and chore for maintenance, tests, or specifications.',
					'Never mark a commit as breaking unless the staged changes clearly break a public API.',
				].join('\n')
			: undefined,
		`Prefer a concise subject around ${maxLength} characters, but always finish the thought even if it needs to be longer.`,
		includeBody
			? 'Return a concise, non-empty body after a blank line.'
			: 'Return no body.',
		'Complete the subject; never end it with an ellipsis.',
		customPrompt,
	]
		.filter(Boolean)
		.join('\n');

const truncateDiff = (diff: string) =>
	diff.length > MAX_DIFF_LENGTH
		? `${diff.slice(0, MAX_DIFF_LENGTH)}\n\n[Diff truncated]`
		: diff;

const sumTokenCounts = (counts: Array<number | undefined>) =>
	counts.every((count) => count === undefined)
		? undefined
		: counts.reduce<number>((total, count) => total + (count ?? 0), 0);

const combineUsage = (usages: LanguageModelUsage[]): LanguageModelUsage => ({
	inputTokens: sumTokenCounts(usages.map((usage) => usage.inputTokens)),
	inputTokenDetails: {
		noCacheTokens: sumTokenCounts(
			usages.map((usage) => usage.inputTokenDetails.noCacheTokens)
		),
		cacheReadTokens: sumTokenCounts(
			usages.map((usage) => usage.inputTokenDetails.cacheReadTokens)
		),
		cacheWriteTokens: sumTokenCounts(
			usages.map((usage) => usage.inputTokenDetails.cacheWriteTokens)
		),
	},
	outputTokens: sumTokenCounts(usages.map((usage) => usage.outputTokens)),
	outputTokenDetails: {
		textTokens: sumTokenCounts(
			usages.map((usage) => usage.outputTokenDetails.textTokens)
		),
		reasoningTokens: sumTokenCounts(
			usages.map((usage) => usage.outputTokenDetails.reasoningTokens)
		),
	},
	totalTokens: sumTokenCounts(usages.map((usage) => usage.totalTokens)),
});

const getModelDetails = (model: LanguageModel) =>
	typeof model === 'string'
		? { provider: '', modelId: model }
		: { provider: model.provider, modelId: model.modelId };

type AgentReasoningOptions = {
	reasoning?: LanguageModelCallOptions['reasoning'];
	providerOptions?: Record<string, Record<string, JSONValue>>;
};

const getXAiReasoningOptions = (modelId: string): AgentReasoningOptions => {
	if (modelId.startsWith('grok-4.5')) {
		return {
			reasoning: 'low',
			providerOptions: { xai: { reasoningEffort: 'low' } },
		};
	}
	if (modelId.startsWith('grok-4.3')) {
		return {
			reasoning: 'none',
			providerOptions: { xai: { reasoningEffort: 'none' } },
		};
	}
	return {};
};

const parseOneShotMessage = (
	text: string,
	includeBody: boolean
): CommitMessage => {
	const lines = text
		.replace(/```(?:\w+)?/g, '')
		.trim()
		.split('\n');
	const subject = (lines.shift() || '').trim();
	if (!subject) {
		throw new Error('The model did not generate a commit message.');
	}
	const body = includeBody ? lines.join('\n').trim() : '';
	if (includeBody && !body) {
		throw new Error('The model did not generate a commit message description.');
	}
	return { subject, ...(body ? { body } : {}) };
};

export const generateCommitMessage = async ({
	model,
	cwd,
	files,
	type,
	locale,
	maxLength,
	includeBody,
	timeout,
	customPrompt,
}: GenerateCommitMessageOptions) => {
	const getStagedDiff = async (paths: string[]) => {
		if (paths.some((path) => !files.includes(path))) {
			throw new Error('Only staged files may be read.');
		}

		const { stdout } = await execa(
			'git',
			[
				'--literal-pathspecs',
				'diff',
				'--cached',
				'--diff-algorithm=minimal',
				'--',
				...paths,
			],
			{ cwd }
		);
		return stdout;
	};
	const stagedDiff = await getStagedDiff(files);
	const { provider, modelId } = getModelDetails(model);
	const isTogetherModel = provider.startsWith('togetherai.');
	const isOpenAiModel = provider.startsWith('openai.');
	const isXAiModel = provider.startsWith('xai.');
	const isLmStudioModel = provider.startsWith('lmstudio.');
	const useAgent =
		(isTogetherModel &&
			supportsTogetherAgenticGeneration(modelId)) ||
		isOpenAiModel ||
		isXAiModel ||
		isLmStudioModel;
	const reasoningOptions: AgentReasoningOptions =
		isTogetherModel && useAgent
			? getTogetherReasoningOptions(modelId)
			: isOpenAiModel && useAgent
				? {
						reasoning: 'none' as const,
						providerOptions: {
							openai: { reasoningEffort: 'none' },
						},
					}
				: isXAiModel && useAgent
					? getXAiReasoningOptions(modelId)
					: {};
	const runOneShot = async (
		prompt: string,
		oneShotIncludeBody = includeBody,
		taskInstruction?: string
	) => {
		const results = [];
		for (let attempt = 1; attempt <= ONE_SHOT_ATTEMPTS; attempt += 1) {
			const result = await generateText({
				model,
				system: buildCommitInstructions(
					{
						type,
						locale,
						maxLength,
						includeBody: oneShotIncludeBody,
						customPrompt,
					},
					[
						'Return only the commit message. Put the subject on the first line.',
						taskInstruction,
					]
				),
				prompt,
				maxOutputTokens: 512,
				timeout,
				...reasoningOptions,
			});
			results.push(result);
			try {
				return {
					message: parseOneShotMessage(
						result.text,
						oneShotIncludeBody
					),
					usage: combineUsage(results.map(({ usage }) => usage)),
					steps: results.reduce(
						(total, current) => total + current.steps.length,
						0
					),
				};
			} catch (error) {
				if (attempt === ONE_SHOT_ATTEMPTS) throw error;
			}
		}
		throw new Error('The model did not generate a commit message.');
	};

	if (!useAgent) {
		if (files.length <= MAX_NON_AGENTIC_FILES) {
			return runOneShot(truncateDiff(stagedDiff));
		}

		const chunkResults = [];
		for (let index = 0; index < files.length; index += NON_AGENTIC_CHUNK_SIZE) {
			const chunkFiles = files.slice(index, index + NON_AGENTIC_CHUNK_SIZE);
			const chunkDiff = await getStagedDiff(chunkFiles);
			chunkResults.push(
				await runOneShot(
					truncateDiff(chunkDiff),
					false,
					'Summarize only this subset of the staged changes.'
				)
			);
		}

		const combined = await runOneShot(
			chunkResults
				.map(({ message }) => message.subject)
				.map((subject) => `- ${subject}`)
				.join('\n'),
			includeBody,
			'Combine these partial commit messages into one message covering the full change.'
		);
		return {
			...combined,
			usage: combineUsage([
				...chunkResults.map(({ usage }) => usage),
				combined.usage,
			]),
			steps:
				chunkResults.reduce((total, result) => total + result.steps, 0) +
				combined.steps,
		};
	}

	const hasCompleteDiff = stagedDiff.length <= MAX_DIFF_LENGTH;
	const readStagedDiff = tool({
		description: 'Read the staged Git diff for one or more staged files.',
		inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
		execute: async ({ paths }) => {
			const stdout = await getStagedDiff(paths);
			return stdout.length > MAX_DIFF_LENGTH
				? `${stdout.slice(0, MAX_DIFF_LENGTH)}\n\n[Diff truncated]`
				: stdout;
		},
	});
	const submitCommitMessage = tool({
		description: 'Submit the final commit message.',
		inputSchema: z.object({
			subject: z.string().min(1),
			body: includeBody
				? z.string().trim().min(1)
				: z.string().nullable().optional(),
		}),
	});
	let agentStreamError: unknown;
	const agent = new ToolLoopAgent({
		model,
		instructions: buildCommitInstructions(
			{ type, locale, maxLength, includeBody, customPrompt },
			[
				'Use the available context and tools, then call submitCommitMessage. Never answer with prose.',
				'Call readStagedDiff only when the provided context is insufficient.',
			]
		),
		tools: { readStagedDiff, submitCommitMessage },
		toolChoice: 'required',
		stopWhen: [
			hasToolCall('submitCommitMessage'),
			stepCountIs(MAX_AGENT_STEPS),
		],
		maxOutputTokens: 512,
		...reasoningOptions,
		prepareStep: ({ stepNumber }) => ({
			toolChoice:
				!isLmStudioModel && stepNumber === MAX_AGENT_STEPS - 1
					? { type: 'tool', toolName: 'submitCommitMessage' }
					: 'required',
		}),
	});

	const streamOptions = {
		prompt: [
			`Staged files:\n${files.map((file) => `- ${file}`).join('\n')}`,
			hasCompleteDiff
				? `The complete staged diff is included below. Submit directly unless another diff read is necessary.\n\n${stagedDiff}`
				: 'The staged diff is too large to include. Read the relevant staged diffs before submitting.',
		].join('\n\n'),
		timeout,
		onError: ({ error }: { error: unknown }) => {
			agentStreamError = error;
		},
	};
	const runAgent = async () => {
		agentStreamError = undefined;
		const result = await agent.stream(streamOptions);
		let staticToolCalls: Awaited<typeof result.staticToolCalls>;
		try {
			staticToolCalls = await result.staticToolCalls;
		} catch (error) {
			throw agentStreamError ?? error;
		}
		return {
			result,
			submission: staticToolCalls.find(
				(call) => call.toolName === 'submitCommitMessage'
			),
		};
	};
	const agentAttempts: Awaited<ReturnType<typeof runAgent>>[] = [];
	try {
		for (let attempt = 1; attempt <= AGENT_ATTEMPTS; attempt += 1) {
			const result = await runAgent();
			agentAttempts.push(result);
			if (result.submission) break;
		}
	} catch (error) {
		if (!isToolUnsupportedError(error)) throw error;
		return runOneShot(truncateDiff(stagedDiff));
	}
	const submission = agentAttempts.find(
		(attempt) => attempt.submission
	)?.submission;
	if (!submission) {
		if (isLmStudioModel) {
			return runOneShot(truncateDiff(stagedDiff));
		}
		throw new Error('The model did not submit a commit message.');
	}

	const subject = submission.input.subject
		.trim()
		.split('\n')[0];
	const body = includeBody ? submission.input.body?.trim() : undefined;

	return {
		message: { subject, ...(body ? { body } : {}) },
		usage: combineUsage(
			await Promise.all(
				agentAttempts.map(({ result }) => result.usage)
			)
		),
		steps: (
			await Promise.all(
				agentAttempts.map(({ result }) => result.steps)
			)
		).reduce((total, steps) => total + steps.length, 0),
	};
};
