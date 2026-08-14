import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import { KnownError } from '../utils/error.js';
import { parseCommitMessage, type CommitMessage } from './generate-commit-message.js';
import type { CommitType } from '../utils/config-types.js';

type Options = {
	cwd: string;
	diff: string;
	type: CommitType;
	locale: string;
	maxLength: number;
	includeBody: boolean;
	timeout: number;
	customPrompt?: string;
};

const formatFor = (type: CommitType) =>
	type === 'conventional' || type === 'conventional+body'
		? 'Conventional Commits: <type>(optional scope): <subject>'
		: type === 'gitmoji'
			? 'Gitmoji: <emoji> <subject>'
			: 'plain text';

const buildPrompt = ({ type, locale, maxLength, includeBody, customPrompt }: Options) =>
	[
		'Generate one accurate Git commit message using only the staged diff attached on stdin.',
		'Return only the commit message. Do not use Markdown, explanations, or code fences.',
		'Mention the important behavior change, not file names.',
		`Write in ${locale}. Format: ${formatFor(type)}.`,
		`Prefer a concise subject around ${maxLength} characters, but finish the thought.`,
		includeBody
			? 'Return a concise non-empty body after one blank line.'
			: 'Return a subject only, with no body.',
		'Never end the subject with an ellipsis.',
		customPrompt,
	]
		.filter(Boolean)
		.join('\n');

export const generateCodexCommitMessage = async (options: Options): Promise<CommitMessage> => {
	const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aicommits-codex-'));
	const outputPath = path.join(tempDirectory, 'message.txt');
	try {
		await execa(
			'codex',
			[
				'exec', '--ephemeral', '--sandbox', 'read-only', '--output-last-message', outputPath,
				buildPrompt(options),
			],
			{ cwd: options.cwd, input: options.diff, timeout: options.timeout }
		);
		return parseCommitMessage(await fs.readFile(outputPath, 'utf8'), options.includeBody);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/command not found|ENOENT/.test(message)) {
			throw new KnownError('Codex CLI was not found. Install Codex and run `codex login`, then try again.');
		}
		throw error;
	} finally {
		await fs.rm(tempDirectory, { recursive: true, force: true });
	}
};
