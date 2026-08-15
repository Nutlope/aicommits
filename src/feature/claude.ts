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

export const generateClaudeCommitMessage = async (options: Options): Promise<CommitMessage> => {
	try {
		const { stdout } = await execa(
			'claude',
			[
				'--print', '--no-session-persistence', '--tools', '', '--output-format', 'json',
				buildPrompt(options),
			],
			{ cwd: options.cwd, input: options.diff, timeout: options.timeout }
		);
		const result = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
		if (result.is_error || typeof result.result !== 'string') {
			throw new KnownError('Claude CLI did not return a commit message.');
		}
		return parseCommitMessage(result.result, options.includeBody);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/command not found|ENOENT/.test(message)) {
			throw new KnownError('Claude CLI was not found. Install Claude Code and sign in, then try again.');
		}
		throw error;
	}
};
