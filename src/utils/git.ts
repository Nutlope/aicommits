import { execa } from 'execa';
import { KnownError } from './error.js';
import { parseStagedFiles } from './staged-files.js';

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

export const getStagedFileChanges = async (excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const customExcludes = excludeFiles ? excludeFiles.map(excludeFromDiff) : [];

	// First, get all staged files without any excludes
	const { stdout: allFilesOutput } = await execa('git', [
		...diffCached,
		'--name-status',
		'-z',
		'--find-renames',
		'--',
		...customExcludes,
	]);

	if (!allFilesOutput) {
		return;
	}

	const allFiles = parseStagedFiles(allFilesOutput);

	// Check if all staged files are lock files
	const hasNonLockFiles = allFiles.some(file => !isLockFile(file.path));

	return hasNonLockFiles
		? allFiles.filter((file) => !isLockFile(file.path))
		: allFiles;
};

// Preserve the path-only API used by commit hooks and AI generation.
export const getStagedFiles = async (excludeFiles?: string[]) =>
	(await getStagedFileChanges(excludeFiles))?.map(({ path }) => path);

export const getDetectedMessage = (files: string[]) =>
	`Detected ${files.length.toLocaleString()} staged file${
		files.length > 1 ? 's' : ''
	}`;
