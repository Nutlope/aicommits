import {
	ToolLoopAgent,
	generateText,
	hasToolCall,
	stepCountIs,
	tool,
	type LanguageModelUsage,
} from 'ai';
import { execa } from 'execa';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { GenerationModel } from './providers/base.js';
import {
	getCommitTypePolicy,
	type CommitType,
} from '../utils/config-types.js';
import {
	isInvalidJsonResponseError,
	isToolUnsupportedError,
	KnownError,
} from '../utils/error.js';

const MAX_DIFF_CHARACTERS = 30_000;
const MAX_LOCAL_DIFF_CHARACTERS = 3_000;
const MAX_DIFF_CHUNKS = 20;
const MAX_GIT_PATHS_PER_BATCH = 200;
const MAX_GIT_PATHSPEC_BYTES = 32_000;
const MAX_CHANGED_FILE_TREE_CHARACTERS = 10_000;
const MAX_CHANGED_FILE_TREE_ENTRIES_PER_DIRECTORY = 50;
const MAX_INSPECTION_GROUPS = 5;
const MAX_MODEL_CALLS = 42;
const MAX_AGENT_STEPS = 4;
const MAX_AGENT_DIFF_READS = MAX_AGENT_STEPS - 1;
const MIN_AGENT_DIFF_READ_BYTES = 256;
const AGENT_ATTEMPTS = 2;
const ONE_SHOT_ATTEMPTS = 3;

export type CommitMessage = {
	subject: string;
	body?: string;
};

export const formatCommitMessage = ({ subject, body }: CommitMessage) =>
	body ? `${subject}\n\n${body}` : subject;

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

const formatInstructions = {
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
) => {
	const { format } = getCommitTypePolicy(type);
	return [
		'Write an accurate Git commit message for the staged changes.',
		...pathInstructions,
		'Mention the important behavior change, not file names.',
		`Write in ${locale}. Format: ${formatInstructions[format]}.`,
		format === 'conventional'
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
};

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
	return chunks;
};

const selectEvenlyDistributed = <Item>(items: Item[], maximum: number) => {
	if (maximum <= 0) return [];
	if (items.length <= maximum) return items;
	if (maximum === 1) return [items[0]];
	return Array.from({ length: maximum }, (_, index) =>
		items[Math.round((index * (items.length - 1)) / (maximum - 1))]
	);
};

type ChangedFileTreeNode = {
	name: string;
	path: string;
	changedFiles: number;
	files: string[];
	directories: Map<string, ChangedFileTreeNode>;
};

type StagedFileGroup = {
	label: string;
	files: string[];
};

const createChangedFileTree = (files: string[]) => {
	const root: ChangedFileTreeNode = {
		name: '',
		path: '',
		changedFiles: files.length,
		files: [],
		directories: new Map(),
	};
	for (const file of files) {
		const segments = file.split('/');
		let node = root;
		for (const [index, segment] of segments.entries()) {
			if (index === segments.length - 1) {
				node.files.push(file);
				continue;
			}
			let directory = node.directories.get(segment);
			if (!directory) {
				const path = node.path ? `${node.path}/${segment}` : segment;
				directory = {
					name: segment,
					path,
					changedFiles: 0,
					files: [],
					directories: new Map(),
				};
				node.directories.set(segment, directory);
			}
			directory.changedFiles += 1;
			node = directory;
		}
	}
	return root;
};

const renderChangedFileTree = (
	node: ChangedFileTreeNode,
	maximumEntries: number,
	depth = 0
): string[] => {
	const indent = '  '.repeat(depth);
	const directories = [...node.directories.values()].sort((a, b) =>
		a.name.localeCompare(b.name)
	);
	const files = [...node.files].sort((a, b) => a.localeCompare(b));
	const selectedDirectories = selectEvenlyDistributed(
		directories,
		maximumEntries
	);
	const selectedFiles = selectEvenlyDistributed(files, maximumEntries);
	const lines: string[] = [];
	for (const directory of selectedDirectories) {
		const representative =
			directory.directories.size > maximumEntries ||
			directory.files.length > maximumEntries;
		lines.push(
			`${indent}- ${directory.path}/ (${directory.changedFiles.toLocaleString()} changed files${
				representative ? '; representative entries shown' : ''
			})`
		);
		lines.push(
			...renderChangedFileTree(directory, maximumEntries, depth + 1)
		);
	}
	for (const file of selectedFiles) {
		lines.push(`${indent}- ${file}`);
	}
	return lines;
};

const formatChangedFileTree = (files: string[]) => {
	const tree = createChangedFileTree(files);
	for (
		let maximumEntries = MAX_CHANGED_FILE_TREE_ENTRIES_PER_DIRECTORY;
		maximumEntries > 0;
		maximumEntries -= 1
	) {
		const treeLines = renderChangedFileTree(tree, maximumEntries);
		const treeText = `${files.length.toLocaleString()} changed files (folder tree; some large folders show representative names):\n${treeLines.join('\n')}`;
		if (treeText.length <= MAX_CHANGED_FILE_TREE_CHARACTERS) {
			return treeText;
		}
	}
	return `${files.length.toLocaleString()} changed files`;
};

const normalizeTreeSelector = (selector: string) =>
	selector.replace(/^\.\//, '').replace(/\/+$/, '');

const matchesTreeSelector = (file: string, selector: string) => {
	const normalizedSelector = normalizeTreeSelector(selector);
	return (
		normalizedSelector === '.' ||
		file === normalizedSelector ||
		file.startsWith(`${normalizedSelector}/`)
	);
};

const resolveInspectionGroups = (
	files: string[],
	groups: Array<{ name: string; selectors: string[] }>
): StagedFileGroup[] => {
	const remainingFiles = new Set(files);
	const resolvedGroups: StagedFileGroup[] = [];
	for (const group of groups) {
		const groupFiles = files.filter(
			(file) =>
				remainingFiles.has(file) &&
				group.selectors.some((selector) =>
					matchesTreeSelector(file, selector)
				)
		);
		if (groupFiles.length === 0) continue;
		for (const file of groupFiles) remainingFiles.delete(file);
		resolvedGroups.push({ label: group.name, files: groupFiles });
	}
	if (remainingFiles.size > 0) {
		resolvedGroups.push({
			label: 'Other changed files',
			files: files.filter((file) => remainingFiles.has(file)),
		});
	}
	return resolvedGroups;
};

const batchGitPaths = (paths: string[]) => {
	const batches: string[][] = [];
	let batch: string[] = [];
	let batchBytes = 0;
	for (const path of paths) {
		const pathBytes = Buffer.byteLength(path) + 1;
		if (
			batch.length > 0 &&
			(batch.length >= MAX_GIT_PATHS_PER_BATCH ||
				batchBytes + pathBytes > MAX_GIT_PATHSPEC_BYTES)
		) {
			batches.push(batch);
			batch = [];
			batchBytes = 0;
		}
		batch.push(path);
		batchBytes += pathBytes;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
};

type StagedDiffSelection = {
	content: string;
	totalBytes: number;
	complete: boolean;
};

const decodeCompleteUtf8 = (buffer: Buffer, bytesRead: number) => {
	let start = 0;
	while (start < bytesRead && (buffer[start] & 0xc0) === 0x80) {
		start += 1;
	}

	let end = bytesRead;
	if (end > start) {
		let finalCharacterStart = end - 1;
		while (
			finalCharacterStart > start &&
			(buffer[finalCharacterStart] & 0xc0) === 0x80
		) {
			finalCharacterStart -= 1;
		}
		const firstByte = buffer[finalCharacterStart];
		const sequenceLength =
			firstByte <= 0x7f
				? 1
				: firstByte <= 0xdf
					? 2
					: firstByte <= 0xef
						? 3
						: 4;
		if (finalCharacterStart + sequenceLength > end) {
			end = finalCharacterStart;
		}
	}

	return buffer.subarray(start, end).toString('utf8');
};

const readStagedDiffSelection = async (
	path: string,
	maximumBytes: number
): Promise<StagedDiffSelection> => {
	const { size: totalBytes } = await stat(path);
	if (totalBytes <= maximumBytes) {
		return {
			content: await readFile(path, 'utf8'),
			totalBytes,
			complete: true,
		};
	}

	let sampleCount = MAX_DIFF_CHUNKS;
	let header = '';
	let labels: string[] = [];
	let metadataBytes = 0;
	while (sampleCount > 0) {
		header = `[The staged diff is ${totalBytes.toLocaleString()} bytes. The following ${sampleCount} representative excerpts are distributed across the complete diff.]\n`;
		labels = Array.from(
			{ length: sampleCount },
			(_, index) =>
				`\n[Representative diff excerpt ${index + 1}/${sampleCount}]\n`
		);
		metadataBytes = Buffer.byteLength(header) +
			labels.reduce((total, label) => total + Buffer.byteLength(label), 0);
		if (metadataBytes + sampleCount <= maximumBytes) break;
		sampleCount -= 1;
	}

	if (sampleCount === 0) {
		const marker = '[Diff read budget exhausted]';
		return {
			content: Buffer.from(marker).subarray(0, maximumBytes).toString('utf8'),
			totalBytes,
			complete: false,
		};
	}

	const sampleBytes = Math.floor(
		(maximumBytes - metadataBytes) / sampleCount
	);
	const lastStart = Math.max(0, totalBytes - sampleBytes);
	const handle = await open(path, 'r');
	try {
		const samples = [];
		for (let index = 0; index < sampleCount; index += 1) {
			const start = Math.round(
				(index * lastStart) / Math.max(1, sampleCount - 1)
			);
			const buffer = Buffer.allocUnsafe(sampleBytes);
			const { bytesRead } = await handle.read(
				buffer,
				0,
				sampleBytes,
				start
			);
			samples.push(
				`${labels[index]}${decodeCompleteUtf8(buffer, bytesRead)}`
			);
		}
		return {
			content: `${header}${samples.join('')}`,
			totalBytes,
			complete: false,
		};
	} finally {
		await handle.close();
	}
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

export const parseCommitMessage = (
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
	const { languageModel, mode, isLocal, callOptions } = model;
	const useAgent = mode === 'agentic';
	const maxDiffCharacters = isLocal
		? MAX_LOCAL_DIFF_CHARACTERS
		: MAX_DIFF_CHARACTERS;
	// A conservative byte budget keeps decoded excerpts within character chunks.
	const maxDiffBytes = maxDiffCharacters;
	const maxSelectedDiffBytes = maxDiffBytes * MAX_DIFF_CHUNKS;
	const budget = createGenerationBudget(timeout);
	const stagedFiles = new Set(files);
	const changedFileTree = formatChangedFileTree(files);
	const getStagedDiff = async (
		paths: string[],
		maximumBytes: number
	): Promise<StagedDiffSelection> => {
		if (paths.some((path) => !stagedFiles.has(path))) {
			throw new Error('Only staged files may be read.');
		}

		const temporaryDirectory = await mkdtemp(
			join(tmpdir(), 'aicommits-diff-')
		);
		const diffPath = join(temporaryDirectory, 'staged.diff');
		try {
			for (const [index, pathBatch] of batchGitPaths(paths).entries()) {
				const batchDiffPath = join(
					temporaryDirectory,
					`staged-${index}.diff`
				);
				try {
					await execa(
						'git',
						[
							'--literal-pathspecs',
							'diff',
							'--cached',
							'--diff-algorithm=minimal',
							`--output=${batchDiffPath}`,
							'--',
							...pathBatch,
						],
						{
							cwd,
							timeout: budget.remainingTime(),
						}
					);
					await pipeline(
						createReadStream(batchDiffPath),
						createWriteStream(diffPath, { flags: 'a' })
					);
				} finally {
					await rm(batchDiffPath, { force: true });
				}
			}
			return await readStagedDiffSelection(diffPath, maximumBytes);
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	};
	const stagedDiff = await getStagedDiff(files, maxSelectedDiffBytes);
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
					message: parseCommitMessage(
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
		const allDiffChunks = splitCompleteDiff(
			stagedDiff.content,
			maxDiffCharacters
		);
		const diffChunks = selectEvenlyDistributed(
			allDiffChunks,
			MAX_DIFF_CHUNKS
		);
		const chunkResults = [];
		for (const diffChunk of diffChunks) {
			chunkResults.push(
				await runOneShot(
					diffChunk,
					false,
					stagedDiff.complete
						? 'Summarize only this complete segment of the staged diff.'
						: 'Summarize only this representative excerpt of the staged diff.'
				)
			);
		}
		return {
			results: chunkResults,
			complete:
				stagedDiff.complete && diffChunks.length === allDiffChunks.length,
		};
	};
	const runCoveredFallback = async (
		coveredDiff?: Awaited<ReturnType<typeof summarizeCoveredDiff>>
	) => {
		if (stagedDiff.complete && stagedDiff.content.length <= maxDiffCharacters) {
			return runOneShot(stagedDiff.content);
		}
		const diffSummary = coveredDiff ?? (await summarizeCoveredDiff());
		const chunkResults = diffSummary.results;

		const combined = await runOneShot(
			[
				changedFileTree,
				chunkResults
					.map(({ message }) => message.subject)
					.map((subject) => `- ${subject}`)
					.join('\n'),
			].join('\n\n'),
			includeBody,
			diffSummary.complete
				? 'Combine these partial commit messages into one message covering the full change.'
				: 'Combine these representative partial commit messages into one message describing the staged change.'
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

	const hasCompleteDiff =
		stagedDiff.complete && stagedDiff.content.length <= maxDiffCharacters;
	let remainingAgentDiffBytes = maxDiffBytes;
	let agentDiffReads = 0;
	let inspectedStagedChanges = false;
	const inspectStagedChanges = tool({
		description:
			'Group the changed files semantically using file or folder names from the changed-file tree, then inspect balanced representative diffs for every group in one call. Selectors may be exact file paths or folder paths. Groups are applied in order, and unselected files are always included automatically.',
		inputSchema: z.object({
			groups: z
				.array(
					z.object({
						name: z.string().trim().min(1).max(50).regex(/^[^\r\n]+$/),
						selectors: z
							.array(
								z.string().trim().min(1).regex(/^[^\r\n]+$/)
							)
							.min(1)
							.max(50),
					})
				)
				.min(1)
				.max(MAX_INSPECTION_GROUPS),
		}),
		execute: async ({ groups }) => {
			agentDiffReads += 1;
			if (inspectedStagedChanges) {
				return '[Staged changes already inspected]';
			}
			if (
				agentDiffReads > MAX_AGENT_DIFF_READS ||
				remainingAgentDiffBytes < MIN_AGENT_DIFF_READ_BYTES
			) {
				return '[Diff read budget exhausted]';
			}
			inspectedStagedChanges = true;
			const fileGroups = resolveInspectionGroups(files, groups);
			const inspectionBytes = Math.floor(remainingAgentDiffBytes * 0.8);
			const groupHeaders = fileGroups.map(
				(group) =>
					`[${group.label}: ${group.files.length.toLocaleString()}]\n`
			);
			const headerBytes = groupHeaders.reduce(
				(total, header) => total + Buffer.byteLength(header),
				0
			);
			const separatorBytes = Math.max(0, fileGroups.length - 1) * 2;
			const groupDiffBytes = Math.floor(
				(inspectionBytes - headerBytes - separatorBytes) / fileGroups.length
			);
			if (groupDiffBytes < MIN_AGENT_DIFF_READ_BYTES) {
				return '[Diff read budget exhausted]';
			}
			const inspectedGroups = await Promise.all(
				fileGroups.map(async (group, index) => ({
					header: groupHeaders[index],
					diff: await getStagedDiff(group.files, groupDiffBytes),
				}))
			);
			const content = inspectedGroups
				.map(({ header, diff }) => `${header}${diff.content}`)
				.join('\n\n');
			remainingAgentDiffBytes -= Buffer.byteLength(content);
			return content;
		},
	});
	const readStagedDiff = tool({
		description: 'Read the staged Git diff for one or more staged files.',
		inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
		execute: async ({ paths }) => {
			agentDiffReads += 1;
			if (agentDiffReads > MAX_AGENT_DIFF_READS) {
				return '[Diff read call budget exhausted]';
			}
			if (remainingAgentDiffBytes < MIN_AGENT_DIFF_READ_BYTES) {
				return '[Diff read budget exhausted]';
			}
			const selectedDiff = await getStagedDiff(
				paths,
				remainingAgentDiffBytes
			);
			remainingAgentDiffBytes -= Buffer.byteLength(selectedDiff.content);
			return selectedDiff.content;
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
				hasCompleteDiff
					? 'Call readStagedDiff only when the provided context is insufficient.'
					: 'Use the changed-file tree to decide the semantic groups, then call inspectStagedChanges with those group names and file or folder selectors before submitting.',
			]
		),
		tools: { inspectStagedChanges, readStagedDiff, submitCommitMessage },
		toolChoice: 'required',
		stopWhen: [
			hasToolCall('submitCommitMessage'),
			stepCountIs(MAX_AGENT_STEPS),
		],
		maxOutputTokens: 512,
		...callOptions,
		prepareStep: ({ stepNumber }) => {
			if (!isLocal && !hasCompleteDiff && stepNumber === 0) {
				return {
					toolChoice: {
						type: 'tool' as const,
						toolName: 'inspectStagedChanges' as const,
					},
				};
			}
			return {
				toolChoice:
					!isLocal && stepNumber === MAX_AGENT_STEPS - 1
						? {
								type: 'tool' as const,
								toolName: 'submitCommitMessage' as const,
							}
						: ('required' as const),
			};
		},
	});

	const streamOptions = {
		prompt: [
			changedFileTree,
			hasCompleteDiff
				? `The complete staged diff is included below. Submit directly unless another diff read is necessary.\n\n${stagedDiff.content}`
				: `The ${stagedDiff.totalBytes.toLocaleString()}-byte staged diff is too large to include directly. Decide meaningful groups from the folder tree, call inspectStagedChanges once with those groups, then submit one message that captures the overall change.`,
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
		return runCoveredFallback();
	}
	const submission = agentAttempts.find(
		(attempt) => attempt.submission
	)?.submission;
	if (!submission) {
		if (isLocal) {
			return runCoveredFallback();
		}
		throw new Error('The model did not submit a commit message.');
	}

	const subject = normalizeSubject(submission.input.subject);
	const body = includeBody ? submission.input.body?.trim() : undefined;

	return {
		message: { subject, ...(body ? { body } : {}) },
		usage: combineUsage(
			await Promise.all(agentAttempts.map(({ result }) => result.usage))
		),
		steps: (
			await Promise.all(agentAttempts.map(({ result }) => result.steps))
		).reduce((total, steps) => total + steps.length, 0),
	};
};
