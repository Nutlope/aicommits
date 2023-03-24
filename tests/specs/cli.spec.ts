import { createFixture, FsFixture } from 'fs-fixture';
import { ExecaChildProcess, Options } from 'execa';
import { describe, it, beforeAll } from 'vitest';
import { createAicommits, createGit } from '../utils.js';

const { OPENAI_KEY } = process.env;

type GitType = (command: string, args?: string[] | undefined,
	options?: Options<string> | undefined) => ExecaChildProcess<string>;

describe('cli', () => {
	beforeAll(async () => {
		if (process.platform === 'win32') {
			// https://github.com/nodejs/node/issues/31409
			console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
			return;
		}

		if (!OPENAI_KEY) {
			console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		}
	});

	async function createAiCommitsFixture(fixture: FsFixture)
		: Promise<ReturnType<typeof createAicommits>> {
		const aicommits = createAicommits({
			cwd: fixture.path,
			home: fixture.path,
		});

		await aicommits(['config', 'set', `OPENAI_KEY=${OPENAI_KEY}`]);

		return aicommits;
	}

	it.concurrent('Fails on non-Git project', async ({ expect }) => {
		const fixture = await createFixture();

		const aicommits = await createAiCommitsFixture(fixture);

		const { stdout, exitCode } = await (aicommits([], { reject: false }));
		expect(exitCode).toBe(1);
		expect(stdout).toMatch('The current directory must be a Git repository!');
	});

	it.concurrent('Fails on no staged files', async ({ expect }) => {
		const fixture = await createFixture();

		await createGit(fixture.path);

		const aicommits = await createAiCommitsFixture(fixture);

		const { stdout, exitCode } = (await aicommits([], { reject: false }));
		expect(exitCode).toBe(1);
		expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
	});

	it.concurrent('Generates default commit message', async ({ expect }) => {
		const data: Record<string, string> = {
			firstName: 'Hiroki',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json']);

		expect(await getGitStatus(git)).toBe('A  data.json');

		const aicommits = await createAiCommitsFixture(fixture);
		const committing = aicommits();
		selectYesOptionAICommit(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);

		// Default commit message should not include conventional commit prefix
		expect(stdout).not.toMatch(/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):/);
	});

	it.concurrent('Accepts --generate flag, overriding config', async ({ expect }) => {
		const data: Record<string, string> = {
			firstName: 'Hiroki',
			lastName: 'Osame',
			moreChanges: 'Adds more changes to the mix',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
			'data2.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json', 'data2.json']);

		expect(await getGitStatus(git)).toContain('A  data.json');
		expect(await getGitStatus(git)).toContain('A  data2.json');

		// Generate flag should override generate config
		const aicommits = await createAiCommitsFixture(fixture);
		await aicommits(['config', 'set', 'generate=4']);

		const committing = aicommits(['--generate', '2']);
		assertAmountOfChoices(committing, 2, expect);
		selectFirstAICommitFromChoices(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);
	});

	it.concurrent('Generates Japanese commit message via locale config', async ({ expect }) => {
		const data: Record<string, string> = {
			username: 'privatenumber',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json']);

		expect(await getGitStatus(git)).toBe('A  data.json');

		const aicommits = await createAiCommitsFixture(fixture);
		await aicommits(['config', 'set', 'locale=ja']);

		const committing = aicommits();
		selectYesOptionAICommit(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);

		const japanesePattern = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;
		expect(stdout).toMatch(japanesePattern);
	});

	it.concurrent('Generates convential commit message via locale config', async ({ expect }) => {
		const data: Record<string, string> = {
			firstName: 'Hiroki',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json']);

		expect(await getGitStatus(git)).toBe('A  data.json');

		const aicommits = await createAiCommitsFixture(fixture);
		await aicommits(['config', 'set', 'conventional=true']);

		const committing = aicommits();
		selectYesOptionAICommit(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);

		// Regex should not match conventional commit messages
		expect(stdout).toMatch(/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/);
	});

	it.concurrent('Accepts --conventional=false flag, overriding config', async ({ expect }) => {
		const data: Record<string, string> = {
			firstName: 'Hiroki',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json']);

		expect(await getGitStatus(git)).toBe('A  data.json');

		const aicommits = await createAiCommitsFixture(fixture);
		await aicommits(['config', 'set', 'conventional=true']);

		const committing = aicommits(['--conventional', 'false']);
		selectYesOptionAICommit(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);

		// Regex should not match conventional commit messages
		expect(stdout).not.toMatch(/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/);
	});

	it.concurrent('Should not translate conventional commit to locale (Japanese)', async ({ expect }) => {
		const data: Record<string, string> = {
			username: 'privatenumber',
		};

		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const git = await createGit(fixture.path);
		await git('add', ['data.json']);

		expect(await getGitStatus(git)).toBe('A  data.json');

		const aicommits = await createAiCommitsFixture(fixture);
		await aicommits(['config', 'set', 'conventional=true']);
		await aicommits(['config', 'set', 'locale=ja']);

		const committing = aicommits();
		selectYesOptionAICommit(committing);
		await committing;

		expect(await getGitStatus(git)).toBe('');

		const { stdout } = await git('log', ['--oneline']);
		console.log('Committed with:', stdout);

		const japanesePattern = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;
		expect(stdout).toMatch(japanesePattern);
		expect(stdout).toMatch(/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/);
	});

	function selectYesOptionAICommit(committing: ExecaChildProcess<string>) {
		committing.stdout!.on('data', (buffer: Buffer) => {
			const stdout = buffer.toString();
			if (stdout.match('└')) {
				committing.stdin?.write('y');
				committing.stdin?.end();
			}
		});
	}

	function assertAmountOfChoices(committing: ExecaChildProcess<string>, amount: number,
		expect: any) {
		committing.stdout!.on('data', function onPrompt(buffer: Buffer) {
			const stdout = buffer.toString();
			if (stdout.match('└')) {
				const countChoices = stdout.match(/ {2}[●○]/g)?.length ?? 0;

				// 2 choices should be generated
				expect(countChoices).toBe(amount);
				committing.stdout?.off('data', onPrompt);
			}
		});
	}

	function selectFirstAICommitFromChoices(committing: ExecaChildProcess<string>) {
		committing.stdout!.on('data', (buffer: Buffer) => {
			const stdout = buffer.toString();
			if (stdout.match('└')) {
				committing.stdin!.write('\r');
				committing.stdin!.end();
			}
		});
	}

	async function getGitStatus(git: GitType): Promise<string> {
		const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
		return statusBefore.stdout;
	}
});
