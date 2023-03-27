import { ExecaChildProcess, Options } from 'execa';
import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';

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

	describe('CLI', async ({ test, describe }) => {
		const files = {
			'.aicommits': `OPENAI_KEY=${OPENAI_KEY}`,
			'data.json': 'Lorem ipsum dolor sit amet '.repeat(10),
		} as const;

		test('Excludes files', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			expect(await getGitStatus(git)).toBe('A  data.json');

			const { stdout, exitCode } = await aicommits(['--exclude', 'data.json'], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
			await fixture.rm();
		});

		test('Generates commit message', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout: commitMessage } = await git('log', ['--oneline']);
			console.log('Committed with:', commitMessage);

			await fixture.rm();
		});

		test('Accepts --generate flag, overriding config', async ({ onTestFail }) => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits': `${files['.aicommits']}\ngenerate=4`,
			});
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			// Generate flag should override generate config
			const committing = aicommits([
				'--generate', '2',
			]);

			// Hit enter to accept the commit message
			hitEnterToAcceptCommitMessage(committing);

			const { stdout } = await committing;
			const countChoices = stdout.match(/ {2}[●○]/g)?.length ?? 0;

			onTestFail(() => console.log({ stdout }));
			expect(countChoices).toBe(2);

			expect(await getGitStatus(git)).toBe('');

			const { stdout: commitMessage } = await git('log', ['--oneline']);
			console.log('Committed with:', commitMessage);

			await fixture.rm();
		});

		test('Generates Japanese commit message via locale config', async () => {
			// https://stackoverflow.com/a/15034560/911407
			const japanesePattern = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits': `${files['.aicommits']}\nlocale=ja`,
			});
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits();
			selectYesOptionAICommit(committing);
			await committing;

			expect(await getGitStatus(git)).toBe('');

			const { stdout: commitMessage } = await git('log', ['--oneline']);
			console.log('Committed with:', commitMessage);
			expect(commitMessage).toMatch(japanesePattern);

			await fixture.rm();
		});

		describe('proxy', ({ test }) => {
			test('Fails on invalid proxy', async () => {
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits': `${files['.aicommits']}\nproxy=http://localhost:1234`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits([], {
					reject: false,
				});

				selectYesOptionAICommit(committing);

				const { stdout, exitCode } = await committing;

				expect(exitCode).toBe(1);
				expect(stdout).toMatch('connect ECONNREFUSED');

				await fixture.rm();
			});

			test('Connects with config', async () => {
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits': `${files['.aicommits']}\nproxy=http://localhost:8888`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits();
				selectYesOptionAICommit(committing);
				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);

				await fixture.rm();
			});

			test('Connects with env variable', async () => {
				const { fixture, aicommits } = await createFixture(files);
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits([], {
					env: {
						HTTP_PROXY: 'http://localhost:8888',
					},
				});

				selectYesOptionAICommit(committing);
				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);

				await fixture.rm();
			});
		});
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

	function hitEnterToAcceptCommitMessage(committing: ExecaChildProcess<string>) {
		committing.stdout!.on('data', function onPrompt(buffer: Buffer) {
			const stdout = buffer.toString();
			if (stdout.match('└')) {
				committing.stdin!.write('\r');
				committing.stdin!.end();
				committing.stdout?.off('data', onPrompt);
			}
		});
	}

	async function getGitStatus(git: GitType): Promise<string> {
		const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
		return statusBefore.stdout;
	}
});
