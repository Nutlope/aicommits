import { execa } from 'execa';
import { KnownError } from './error.js';

export const assertGitRepo = async () => {
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--show-toplevel'],
		{ reject: false }
	);

	if (failed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return stdout;
};

export const getGitHooksPath = async () => {
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--git-path', 'hooks'],
		{ reject: false }
	);

	if (failed) {
		throw new KnownError('Failed to determine Git hooks directory');
	}

	return stdout;
};

export const getGitDir = async () => {
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--show-toplevel'],
		{ reject: false }
	);

	if (!failed) {
		return stdout;
	}

	const { stdout: gitDir, failed: gitDirFailed } = await execa(
		'git',
		['rev-parse', '--git-dir'],
		{ reject: false }
	);

	if (gitDirFailed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return gitDir;
};

const excludeFromDiff = (path: string) => `:(exclude)${path}`;

const filesToExclude = [
	'package-lock.json',
	'pnpm-lock.yaml',

	// yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
	'*.lock',
].map(excludeFromDiff);

export const getStagedDiff = async (excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const { stdout: files } = await execa('git', [
		...diffCached,
		'--name-only',
		...filesToExclude,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	]);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa('git', [
		...diffCached,
		...filesToExclude,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	]);

	return {
		files: files.split('\n'),
		diff,
	};
};

export const getStagedDiffForFiles = async (files: string[], excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const excludes = [
		...filesToExclude,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	];

	const { stdout: diff } = await execa('git', [
		...diffCached,
		...excludes,
		'--',
		...files,
	]);

	return {
		files,
		diff,
	};
};

export const getDetectedMessage = (files: string[]) =>
	`Detected ${files.length.toLocaleString()} staged file${
		files.length > 1 ? 's' : ''
	}`;
