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

const filesToExclude = lockFilePatterns.map(excludeFromDiff);

export const getStagedDiff = async (excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];

	// First, get all staged files without any excludes
	const { stdout: allFilesOutput } = await execa('git', [
		...diffCached,
		'--name-only',
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	]);

	if (!allFilesOutput) {
		return;
	}

	const allFiles = allFilesOutput.split('\n').filter(Boolean);

	// Check if all staged files are lock files
	const hasNonLockFiles = allFiles.some(file => !isLockFile(file));

	let excludes: string[] = [];
	if (hasNonLockFiles) {
		// If there are non-lock files, exclude lock files
		excludes = [...filesToExclude];
	}
	// If only lock files are staged, don't exclude them

	excludes = [
		...excludes,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	];

	// Get files after applying excludes
	const { stdout: files } = await execa('git', [
		...diffCached,
		'--name-only',
		...excludes,
	]);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa('git', [
		...diffCached,
		...excludes,
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
		'--',
		...files,
		...excludes,
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
