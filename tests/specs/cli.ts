import { testSuite, expect } from 'manten';
import { createFixture, FsFixture } from 'fs-fixture';
import { ExecaChildProcess, Options } from 'execa';
import { createAicommits, createGit } from '../utils.js';

const { OPENAI_KEY } = process.env;

type GitType = (command: string, args?: string[] | undefined,
	options?: Options<string> | undefined) => ExecaChildProcess<string>;

export default testSuite(({ describe }) => {
	if (process.platform === 'win32') {
		// https://github.com/nodejs/node/issues/31409
		console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
		return;
	}

	if (!OPENAI_KEY) {
		console.warn('⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...');
		return;
	}

	describe('CLI', async ({ test }) => {
		async function createAiCommitsFixture(fixture: FsFixture)
		: Promise<ReturnType<typeof createAicommits>> {
			const aicommits = createAicommits({
				cwd: fixture.path,
				home: fixture.path,
			});

			await aicommits(['config', 'set', `OPENAI_KEY=${OPENAI_KEY}`]);

			return aicommits;
		}

		await test('Fails on non-Git project', async () => {
			const fixture = await createFixture();

			const aicommits = await createAiCommitsFixture(fixture);

			const { stdout, exitCode } = await (aicommits([], { reject: false }));
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('The current directory must be a Git repository!');
		});

		await test('Fails on no staged files', async () => {
			const fixture = await createFixture();

			await createGit(fixture.path);

			const aicommits = await createAiCommitsFixture(fixture);

			const { stdout, exitCode } = (await aicommits([], { reject: false }));
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
		});

		await test('Generates default commit message', async () => {
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

		await test('Accepts --generate flag, overriding config', async () => {
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
			assertAmountOfChoices(committing, 2);
			selectFirstAICommitFromChoices(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);
		});

		await test('Generates Japanese commit message via locale config', async () => {
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

		await test('Should not translate conventional commit to locale (Japanese)', async () => {
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
			await aicommits(['config', 'set', 'conventional=true']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			const japanesePattern = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;
			expect(stdout).toMatch(japanesePattern);
			expect(stdout).toMatch(/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):/);
		});

		await test('Generates convential commit message', async () => {
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
			expect(stdout).toMatch(/(feat):/);
		});

		await test('Generates test: convential commit message', async () => {
			const fixture = await createFixture({
				'aicommits.spec.ts': '',
			});

			const git = await createGit(fixture.path);
			await git('add', ['aicommits.spec.ts']);

			await git('commit', ['-m', 'Initial commit']);

			fixture.writeJson('aicommits.spec.ts', 'test(() => {})');

			await git('add', ['aicommits.spec.ts']);

			expect(await getGitStatus(git)).toBe('M  aicommits.spec.ts');

			const aicommits = await createAiCommitsFixture(fixture);
			await aicommits(['config', 'set', 'conventional=true']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			expect(stdout).toMatch(/(test):/);
		});

		await test('Generates (docs|chore): convential commit message', async () => {
			const fixture = await createFixture({
				'README.md': '',
			});

			const git = await createGit(fixture.path);
			await git('add', ['README.md']);

			await git('commit', ['-m', 'Initial commit']);

			fixture.writeJson('README.md', 'This is just some documentation change');

			await git('add', ['README.md']);

			expect(await getGitStatus(git)).toBe('M  README.md');

			const aicommits = await createAiCommitsFixture(fixture);
			await aicommits(['config', 'set', 'conventional=true']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			expect(stdout).toMatch(/(docs|chore):/);
		});

		await test('Generates (ci|build): convential commit message', async () => {
			const fixture = await createFixture({
				'.github': {
					workflows: {
						'deploy.yml': `
name: Deploy
on:
  push:
	branches: [main, develop]
  pull_request:

jobs:
  test:
    name: Test
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]

    timeout-minutes: 10

    steps:
    - name: Checkout
      uses: actions/checkout@v3

    - name: Use Node.js
      uses: actions/setup-node@v3
      with:
        node-version-file: '.nvmrc'
`,
					},
				},
			});

			const git = await createGit(fixture.path);
			await git('add', ['.']);

			const aicommits = await createAiCommitsFixture(fixture);
			await aicommits(['config', 'set', 'conventional=true']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			expect(stdout).toMatch(/(ci|build):/);
		});

		await test('Generates (change|fix): convential commit message', async () => {
			const fixture = await createFixture({
				'index.html': '<button>Click me</button>',
			});

			const git = await createGit(fixture.path);
			await git('add', ['index.html']);

			await git('commit', ['-m', 'Initial commit']);

			fixture.writeJson('index.html', '<button>Click me changed</button>');

			await git('add', ['index.html']);

			expect(await getGitStatus(git)).toBe('M  index.html');

			const aicommits = await createAiCommitsFixture(fixture);
			await aicommits(['config', 'set', 'conventional=true']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			expect(stdout).toMatch(/(change|fix):/);
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

		function assertAmountOfChoices(committing: ExecaChildProcess<string>, amount: number) {
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
});
