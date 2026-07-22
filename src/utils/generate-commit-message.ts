import {
	ToolLoopAgent,
	generateText,
	hasToolCall,
	stepCountIs,
	tool,
	type LanguageModel,
} from 'ai';
import { execa } from 'execa';
import { z } from 'zod';
import { supportsTogetherAgenticGeneration } from '../feature/providers/together.js';
import type { CommitType } from './config-types.js';

const MAX_DIFF_LENGTH = 30_000;
const MAX_AGENT_STEPS = 4;
const TOGETHER_REASONING_ONLY_MODELS = new Set([
	'MiniMaxAI/MiniMax-M2.7',
]);

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

const getModelDetails = (model: LanguageModel) =>
	typeof model === 'string'
		? { provider: '', modelId: model }
		: { provider: model.provider, modelId: model.modelId };

const parseOneShotMessage = (
	text: string,
	maxLength: number,
	includeBody: boolean
): CommitMessage => {
	const lines = text
		.replace(/```(?:\w+)?/g, '')
		.trim()
		.split('\n');
	const subject = (lines.shift() || '').trim().slice(0, maxLength);
	if (!subject) {
		throw new Error('The model did not generate a commit message.');
	}
	const body = includeBody ? lines.join('\n').trim() : '';
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
	const useAgent =
		isTogetherModel && supportsTogetherAgenticGeneration(modelId);
	const disableTogetherReasoning =
		isTogetherModel && !TOGETHER_REASONING_ONLY_MODELS.has(modelId);

	if (!useAgent) {
		const fallbackDiff =
			stagedDiff.length > MAX_DIFF_LENGTH
				? `${stagedDiff.slice(0, MAX_DIFF_LENGTH)}\n\n[Diff truncated]`
				: stagedDiff;
		const result = await generateText({
			model,
			system: [
				'Write an accurate Git commit message for the provided staged diff.',
				'Return only the commit message. Put the subject on the first line.',
				'Mention the important behavior change, not file names.',
				`Write in ${locale}. Format: ${formats[type]}.`,
				type === 'conventional'
					? 'Use fix for corrected behavior; use feat only for a new capability.'
					: undefined,
				`The subject must be at most ${maxLength} characters.`,
				includeBody
					? 'You may add a concise body after a blank line.'
					: 'Return only one subject line with no body.',
				'Complete the subject; never end it with an ellipsis.',
				customPrompt,
			]
				.filter(Boolean)
				.join('\n'),
			prompt: fallbackDiff,
			maxOutputTokens: 512,
			timeout,
			reasoning: disableTogetherReasoning ? 'none' : undefined,
			providerOptions: disableTogetherReasoning
				? { togetherai: { reasoning: { enabled: false } } }
				: undefined,
		});
		return {
			message: parseOneShotMessage(result.text, maxLength, includeBody),
			usage: result.usage,
			steps: result.steps.length,
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
			subject: z.string().min(1).max(maxLength),
			body: z.string().nullable(),
		}),
	});
	const agent = new ToolLoopAgent({
		model,
		instructions: [
			'Write an accurate Git commit message for the staged changes.',
			'Use the available context and tools, then call submitCommitMessage. Never answer with prose.',
			'Call readStagedDiff only when the provided context is insufficient.',
			'Mention the important behavior change, not file names.',
			`Write in ${locale}. Format: ${formats[type]}.`,
			type === 'conventional'
				? 'Use fix for corrected behavior; use feat only for a new capability.'
				: undefined,
			`The subject must be at most ${maxLength} characters.`,
			includeBody
				? 'Add a concise body only when it explains important context.'
				: 'Return no body.',
			'Complete the subject; never end it with an ellipsis.',
			customPrompt,
		]
			.filter(Boolean)
			.join('\n'),
		tools: { readStagedDiff, submitCommitMessage },
		toolChoice: 'required',
		stopWhen: [
			hasToolCall('submitCommitMessage'),
			stepCountIs(MAX_AGENT_STEPS),
		],
		maxOutputTokens: 512,
		reasoning: disableTogetherReasoning ? 'none' : undefined,
		providerOptions: disableTogetherReasoning
			? { togetherai: { reasoning: { enabled: false } } }
			: undefined,
		prepareStep: ({ stepNumber }) => ({
			toolChoice:
				stepNumber === MAX_AGENT_STEPS - 1
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
		onError: () => {},
	};
	const result = await agent.stream(streamOptions);
	const staticToolCalls = await result.staticToolCalls;
	const submission = staticToolCalls.find(
		(call) => call.toolName === 'submitCommitMessage'
	);
	if (!submission) {
		throw new Error('The model did not submit a commit message.');
	}

	const subject = submission.input.subject
		.trim()
		.split('\n')[0]
		.slice(0, maxLength);
	const body = includeBody ? submission.input.body?.trim() : undefined;

	return {
		message: { subject, ...(body ? { body } : {}) },
		usage: await result.usage,
		steps: (await result.steps).length,
	};
};
