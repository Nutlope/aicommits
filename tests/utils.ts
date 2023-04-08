import path from 'path';
import { execa, execaNode, type Options } from 'execa';
import {
	createFixture as createFixtureBase,
	type FileTree,
	type FsFixture,
} from 'fs-fixture';

const aicommitsPath = path.resolve('./dist/cli.mjs');

const createAicommits = (fixture: FsFixture) => {
	const homeEnv = {
		HOME: fixture.path, // Linux
		USERPROFILE: fixture.path, // Windows
	};

	return (
		args?: string[],
		options?: Options,
	) => execaNode(aicommitsPath, args, {
		...options,
		cwd: fixture.path,
		extendEnv: false,
		env: {
			...homeEnv,
			...options?.env,
		},

		// Block tsx nodeOptions
		nodeOptions: [],
	});
};

export const createGit = async (cwd: string) => {
	const git = (
		command: string,
		args?: string[],
		options?: Options,
	) => (
		execa(
			'git',
			[command, ...(args || [])],
			{
				cwd,
				...options,
			},
		)
	);

	await git(
		'init',
		[
			// In case of different default branch name
			'--initial-branch=master',
		],
	);

	await git('config', ['user.name', 'name']);
	await git('config', ['user.email', 'email']);

	return git;
};

export const createFixture = async (
	source?: string | FileTree,
) => {
	const fixture = await createFixtureBase(source);
	const aicommits = createAicommits(fixture);

	return {
		fixture,
		aicommits,
	};
};

export const files = Object.freeze({
	'.aicommits': `OPENAI_KEY=${process.env.OPENAI_KEY}`,
	'data.json': 'Lorem ipsum dolor sit amet '.repeat(10),
});

export const assertOpenAiToken = () => {
	if (!process.env.OPENAI_KEY) {
		throw new Error('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
	}
};
