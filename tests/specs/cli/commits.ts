import { testSuite, expect } from 'manten';
import {
	assertOpenAiToken,
	createFixture,
	createGit,
	files,
} from '../../utils.js';

export default testSuite(({ describe }) => {
	if (process.platform === 'win32') {
		// https://github.com/nodejs/node/issues/31409
		console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
		return;
	}

	assertOpenAiToken();

	describe('Commits', async ({ test, describe }) => {
		test('Excludes files', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusBefore.stdout).toBe('A  data.json');

			const { stdout, exitCode } = await aicommits(['--exclude', 'data.json'], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found.');
			await fixture.rm();
		});

		test('Generates commit message', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits();
			committing.stdout!.on('data', (buffer: Buffer) => {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('y');
					committing.stdin!.end();
				}
			});

			await committing;

			const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusAfter.stdout).toBe('');

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			console.log({
				commitMessage,
				length: commitMessage.length,
			});
			expect(commitMessage.length).toBeLessThanOrEqual(50);

			await fixture.rm();
		});

		test('Generated commit message must be under 20 characters', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits': `${files['.aicommits']}\nmax-length=20`,
			});

			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits();
			committing.stdout!.on('data', (buffer: Buffer) => {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('y');
					committing.stdin!.end();
				}
			});

			await committing;

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			console.log({
				commitMessage,
				length: commitMessage.length,
			});
			expect(commitMessage.length).toBeLessThanOrEqual(32);

			await fixture.rm();
		});

		test('Accepts --all flag, staging all changes before commit', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			await git('commit', ['-m', 'wip']);

			// Change tracked file
			await fixture.writeFile('data.json', 'Test');

			const statusBefore = await git('status', ['--short']);
			expect(statusBefore.stdout).toBe(' M data.json\n?? .aicommits');

			const committing = aicommits(['--all']);
			committing.stdout!.on('data', (buffer: Buffer) => {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('y');
					committing.stdin!.end();
				}
			});

			await committing;

			const statusAfter = await git('status', ['--short']);
			expect(statusAfter.stdout).toBe('?? .aicommits');

			const { stdout: commitMessage } = await git('log', ['-n1', '--pretty=format:%s']);
			console.log({
				commitMessage,
				length: commitMessage.length,
			});
			expect(commitMessage.length).toBeLessThanOrEqual(50);

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
			committing.stdout!.on('data', function onPrompt(buffer: Buffer) {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('\r');
					committing.stdin!.end();
					committing.stdout?.off('data', onPrompt);
				}
			});

			const { stdout } = await committing;
			const countChoices = stdout.match(/ {2}[●○]/g)?.length ?? 0;

			onTestFail(() => console.log({ stdout }));
			expect(countChoices).toBe(2);

			const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusAfter.stdout).toBe('');

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			console.log({
				commitMessage,
				length: commitMessage.length,
			});
			expect(commitMessage.length).toBeLessThanOrEqual(50);

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

			committing.stdout!.on('data', (buffer: Buffer) => {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('y');
					committing.stdin!.end();
				}
			});

			await committing;

			const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusAfter.stdout).toBe('');

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			console.log({
				commitMessage,
				length: commitMessage.length,
			});
			expect(commitMessage).toMatch(japanesePattern);
			expect(commitMessage.length).toBeLessThanOrEqual(50);

			await fixture.rm();
		});

		describe('commit types', ({ test }) => {
			test('Should not use conventional commits by default', async () => {
				const conventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):\s/;
				const { fixture, aicommits } = await createFixture({
					...files,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits();

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);
				expect(commitMessage).not.toMatch(conventionalCommitPattern);

				await fixture.rm();
			});

			test('Conventional commits', async () => {
				const conventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):\s/;
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits': `${files['.aicommits']}\ntype=conventional`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits();

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);
				expect(commitMessage).toMatch(conventionalCommitPattern);

				await fixture.rm();
			});

			test('Accepts --type flag, overriding config', async () => {
				const conventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):\s/;
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits': `${files['.aicommits']}\ntype=other`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				// Generate flag should override generate config
				const committing = aicommits([
					'--type', 'conventional',
				]);

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);
				expect(commitMessage).toMatch(conventionalCommitPattern);

				await fixture.rm();
			});

			test('Accepts empty --type flag', async () => {
				const conventionalCommitPattern = /(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):\s/;
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits': `${files['.aicommits']}\ntype=conventional`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits([
					'--type', '',
				]);

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--oneline']);
				console.log('Committed with:', commitMessage);
				expect(commitMessage).not.toMatch(conventionalCommitPattern);

				await fixture.rm();
			});
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

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

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

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
				console.log({
					commitMessage,
					length: commitMessage.length,
				});
				expect(commitMessage.length).toBeLessThanOrEqual(50);

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

				committing.stdout!.on('data', (buffer: Buffer) => {
					const stdout = buffer.toString();
					if (stdout.match('└')) {
						committing.stdin!.write('y');
						committing.stdin!.end();
					}
				});

				await committing;

				const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
				expect(statusAfter.stdout).toBe('');

				const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
				console.log({
					commitMessage,
					length: commitMessage.length,
				});
				expect(commitMessage.length).toBeLessThanOrEqual(50);

				await fixture.rm();
			});
		});
	});
});
