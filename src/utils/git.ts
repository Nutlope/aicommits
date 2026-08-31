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
		['rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
		{ reject: false }
	);

	if (failed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return stdout;
};

const excludeFromDiff = (path: string) => `:(exclude)${path}`;

const lockFilePatterns = [
	'package-lock.json',
	'pnpm-lock.yaml',
	// yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
	'*.lock',
];

const isLockFile = (file: string) => {
	return lockFilePatterns.some(pattern => {
		if (pattern.includes('*')) {
			// Simple glob match for *.lock
			return file.endsWith('.lock');
		}
		// Match lock files by basename to handle subdirectories
		return file.endsWith('/' + pattern) || file === pattern;
	});
};

export const getStagedFiles = async (excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const customExcludes = excludeFiles ? excludeFiles.map(excludeFromDiff) : [];

	// First, get all staged files without any excludes
	const { stdout: allFilesOutput } = await execa('git', [
		...diffCached,
		'--name-only',
		...customExcludes,
	]);

	if (!allFilesOutput) {
		return;
	}

	const allFiles = allFilesOutput.split('\n').filter(Boolean);

	// Check if all staged files are lock files
	const hasNonLockFiles = allFiles.some(file => !isLockFile(file));

	return hasNonLockFiles
		? allFiles.filter((file) => !isLockFile(file))
		: allFiles;
};

export const getDetectedMessage = (files: string[]) =>
	`Detected ${files.length.toLocaleString()} staged file${
		files.length > 1 ? 's' : ''
	}`;
