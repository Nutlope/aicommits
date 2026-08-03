import {
	ToolLoopAgent,
	generateText,
	hasToolCall,
	stepCountIs,
	tool,
	type LanguageModelUsage,
} from 'ai';
import { execa } from 'execa';
import { z } from 'zod';
import type { GenerationModel } from './providers/base.js';
import type { CommitType } from '../utils/config-types.js';
import {
	isInvalidJsonResponseError,
	isToolUnsupportedError,
	KnownError,
} from '../utils/error.js';

const MAX_DIFF_LENGTH = 30_000;
const MAX_LOCAL_DIFF_LENGTH = 3_000;
const MAX_REMOTE_TOTAL_DIFF_BYTES = 500_000;
const MAX_LOCAL_TOTAL_DIFF_BYTES = 30_000;
const MAX_STAGED_FILES = 100;
const MAX_DIFF_CHUNKS = 20;
const MAX_MODEL_CALLS = 42;
const MAX_AGENT_STEPS = 4;
const MAX_AGENT_DIFF_READS = MAX_AGENT_STEPS - 1;
const AGENT_ATTEMPTS = 2;
const ONE_SHOT_ATTEMPTS = 3;

export type CommitMessage = {
	subject: string;
	body?: string;
};

export type GenerateCommitMessageOptions = {
	model: GenerationModel;
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
	'conventional+body':
		'Conventional Commits: <type>(optional scope): <subject>',
	gitmoji: 'Gitmoji: <emoji> <subject>',
	'subject+body': 'plain text',
};

const isConventionalType = (type: CommitType) =>
	type === 'conventional' || type === 'conventional+body';

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
		isConventionalType(type)
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

const createGenerationBudget = (timeout: number) => {
	const deadline = Date.now() + timeout;
	let modelCalls = 0;

	const remainingTime = () => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new KnownError(`Commit generation timed out after ${timeout}ms.`);
		}
		return remaining;
	};

	return {
		remainingTime,
		nextModelTimeout: () => {
			if (modelCalls >= MAX_MODEL_CALLS) {
				throw new KnownError(
					`Commit generation exceeded the ${MAX_MODEL_CALLS}-request model budget.`
				);
			}
			modelCalls += 1;
			return remainingTime();
		},
	};
};

const splitAtLineBoundary = (text: string, maxLength: number) => {
	const segments: string[] = [];
	let offset = 0;
	while (offset < text.length) {
		let end = Math.min(offset + maxLength, text.length);
		if (end < text.length) {
			const lineEnd = text.lastIndexOf('\n', end);
			if (lineEnd > offset + Math.floor(maxLength / 2)) {
				end = lineEnd + 1;
			}
		}
		segments.push(text.slice(offset, end));
		offset = end;
	}
	return segments;
};

const splitCompleteDiff = (diff: string, maxLength: number) => {
	const fileDiffs = diff.split(/(?=^diff --git )/m).filter(Boolean);
	const segmentContentLength = maxLength - 80;
	const segments = fileDiffs.flatMap((fileDiff) => {
		if (fileDiff.length <= maxLength) return [fileDiff];
		const parts = splitAtLineBoundary(fileDiff, segmentContentLength);
		return parts.map(
			(part, index) =>
				`[Oversized file diff segment ${index + 1}/${parts.length}]\n${part}`
		);
	});
	const chunks: string[] = [];
	let current = '';
	for (const segment of segments) {
		if (current && current.length + segment.length > maxLength) {
			chunks.push(current);
			current = '';
		}
		current += segment;
	}
	if (current) chunks.push(current);

	if (chunks.length > MAX_DIFF_CHUNKS) {
		throw new KnownError(
			`The staged diff needs ${chunks.length} analysis chunks; the safe maximum is ${MAX_DIFF_CHUNKS}. Split this commit into smaller changes.`
		);
	}
	return chunks;
};

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

const isCompleteSubject = (subject: string) =>
	!/(?:\.\.\.|…)\s*$/.test(subject);

const normalizeSubject = (subject: string) =>
	subject.trim().split('\n')[0].trim();

const validateSubject = (subject: string) => {
	const normalizedSubject = normalizeSubject(subject);
	if (!normalizedSubject) {
		throw new Error('The model did not generate a commit message.');
	}
	if (!isCompleteSubject(normalizedSubject)) {
		throw new Error('The model generated an incomplete commit message.');
	}
	return normalizedSubject;
};

const parseOneShotMessage = (
	text: string,
	includeBody: boolean
): CommitMessage => {
	const lines = text
		.replace(/```(?:\w+)?/g, '')
		.trim()
		.split('\n');
	const subject = validateSubject(lines.shift() || '');
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
	if (files.length > MAX_STAGED_FILES) {
		throw new KnownError(
			`Commit generation supports at most ${MAX_STAGED_FILES} staged files; found ${files.length}. Split this commit into smaller changes.`
		);
	}

	const { languageModel, mode, isLocal, callOptions } = model;
	const useAgent = mode === 'agentic';
	const maxDiffLength = isLocal ? MAX_LOCAL_DIFF_LENGTH : MAX_DIFF_LENGTH;
	const maxTotalDiffBytes = isLocal
		? MAX_LOCAL_TOTAL_DIFF_BYTES
		: MAX_REMOTE_TOTAL_DIFF_BYTES;
	const budget = createGenerationBudget(timeout);
	let remainingGitDiffBytes = maxTotalDiffBytes;
	const getStagedDiff = async (paths: string[]) => {
		if (paths.some((path) => !files.includes(path))) {
			throw new Error('Only staged files may be read.');
		}
		if (remainingGitDiffBytes <= 0) {
			throw new KnownError('The staged diff read budget is exhausted.');
		}

		let stdout: string;
		try {
			({ stdout } = await execa(
				'git',
				[
					'--literal-pathspecs',
					'diff',
					'--cached',
					'--diff-algorithm=minimal',
					'--',
					...paths,
				],
				{
					cwd,
					maxBuffer: remainingGitDiffBytes,
					timeout: budget.remainingTime(),
				}
			));
		} catch (error) {
			if (
				error instanceof Error &&
				(error.name === 'MaxBufferError' ||
					error.message.includes('maxBuffer exceeded'))
			) {
				throw new KnownError(
					`The staged diff exceeds the ${maxTotalDiffBytes.toLocaleString()}-byte analysis budget. Split this commit into smaller changes.`
				);
			}
			throw error;
		}
		remainingGitDiffBytes -= Buffer.byteLength(stdout);
		return stdout;
	};
	const stagedDiff = await getStagedDiff(files);
	const runOneShot = async (
		prompt: string,
		oneShotIncludeBody = includeBody,
		taskInstruction?: string
	) => {
		const results = [];
		for (let attempt = 1; attempt <= ONE_SHOT_ATTEMPTS; attempt += 1) {
			let result;
			try {
				result = await generateText({
					model: languageModel,
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
					timeout: budget.nextModelTimeout(),
					...callOptions,
				});
			} catch (error) {
				if (
					isLocal &&
					attempt < ONE_SHOT_ATTEMPTS &&
					isInvalidJsonResponseError(error)
				) {
					continue;
				}
				throw error;
			}
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

	const summarizeCoveredDiff = async () => {
		const diffChunks = splitCompleteDiff(stagedDiff, maxDiffLength);
		const chunkResults = [];
		for (const diffChunk of diffChunks) {
			chunkResults.push(
				await runOneShot(
					diffChunk,
					false,
					'Summarize only this complete segment of the staged diff.'
				)
			);
		}
		return chunkResults;
	};
	const runCoveredFallback = async (
		coveredChunks?: Awaited<ReturnType<typeof summarizeCoveredDiff>>
	) => {
		if (stagedDiff.length <= maxDiffLength) return runOneShot(stagedDiff);
		const chunkResults = coveredChunks ?? (await summarizeCoveredDiff());

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
	};

	if (!useAgent) {
		return runCoveredFallback();
	}

	const hasCompleteDiff = stagedDiff.length <= maxDiffLength;
	const coveredDiffSummaries = hasCompleteDiff
		? []
		: await summarizeCoveredDiff();
	let remainingAgentDiffLength = maxDiffLength;
	let agentDiffReads = 0;
	const readStagedDiff = tool({
		description: 'Read the staged Git diff for one or more staged files.',
		inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
		execute: async ({ paths }) => {
			agentDiffReads += 1;
			if (agentDiffReads > MAX_AGENT_DIFF_READS) {
				return '[Diff read call budget exhausted]';
			}
			if (remainingAgentDiffLength <= 0) {
				return '[Diff read budget exhausted]';
			}
			const stdout = await getStagedDiff(paths);
			if (stdout.length > remainingAgentDiffLength) {
				return `[Requested diff is ${stdout.length.toLocaleString()} characters but only ${remainingAgentDiffLength.toLocaleString()} remain. Request fewer staged paths.]`;
			}
			remainingAgentDiffLength -= stdout.length;
			return stdout;
		},
	});
	const submitCommitMessage = tool({
		description: 'Submit the final commit message.',
		inputSchema: z.object({
			subject: z
				.string()
				.transform(normalizeSubject)
				.pipe(
					z
						.string()
						.min(1)
						.refine(
							isCompleteSubject,
							'Subject must not end with an ellipsis.'
						)
				),
			body: includeBody
				? z.string().trim().min(1)
				: z.string().nullable().optional(),
		}),
	});
	let agentStreamError: unknown;
	const agent = new ToolLoopAgent({
		model: languageModel,
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
		...callOptions,
		prepareStep: ({ stepNumber }) => ({
			toolChoice:
				!isLocal && stepNumber === MAX_AGENT_STEPS - 1
					? { type: 'tool', toolName: 'submitCommitMessage' }
					: 'required',
		}),
	});

	const streamOptions = {
		prompt: [
			`Staged files:\n${files.map((file) => `- ${file}`).join('\n')}`,
			hasCompleteDiff
				? `The complete staged diff is included below. Submit directly unless another diff read is necessary.\n\n${stagedDiff}`
				: [
						'The complete staged diff was analyzed in bounded segments. Submit a message covering all segment summaries below.',
						...coveredDiffSummaries.map(
							({ message }, index) =>
								`Segment ${index + 1}: ${message.subject}`
						),
					].join('\n'),
		].join('\n\n'),
		onError: ({ error }: { error: unknown }) => {
			agentStreamError = error;
		},
	};
	const runAgent = async () => {
		agentStreamError = undefined;
		const result = await agent.stream({
			...streamOptions,
			timeout: budget.nextModelTimeout(),
		});
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
			let result: Awaited<ReturnType<typeof runAgent>>;
			try {
				result = await runAgent();
			} catch (error) {
				if (
					isLocal &&
					attempt < AGENT_ATTEMPTS &&
					isInvalidJsonResponseError(error)
				) {
					continue;
				}
				throw error;
			}
			agentAttempts.push(result);
			if (result.submission) break;
		}
	} catch (error) {
		if (!isToolUnsupportedError(error)) throw error;
		return runCoveredFallback(coveredDiffSummaries);
	}
	const submission = agentAttempts.find(
		(attempt) => attempt.submission
	)?.submission;
	if (!submission) {
		if (isLocal) {
			return runCoveredFallback(coveredDiffSummaries);
		}
		throw new Error('The model did not submit a commit message.');
	}

	const subject = normalizeSubject(submission.input.subject);
	const body = includeBody ? submission.input.body?.trim() : undefined;

	return {
		message: { subject, ...(body ? { body } : {}) },
		usage: combineUsage(
			[
				...coveredDiffSummaries.map(({ usage }) => usage),
				...(await Promise.all(
					agentAttempts.map(({ result }) => result.usage)
				)),
			]
		),
		steps:
			coveredDiffSummaries.reduce(
				(total, summary) => total + summary.steps,
				0
			) +
			(
				await Promise.all(
					agentAttempts.map(({ result }) => result.steps)
				)
			).reduce((total, steps) => total + steps.length, 0),
	};
};
