import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { createAicommits, createGit } from '../utils.js';

const { OPENAI_KEY } = process.env;

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
		const data: Record<string, string> = {
			firstName: 'Hiroki',
		};
		const fixture = await createFixture({
			'data.json': JSON.stringify(data),
		});

		const aicommits = createAicommits({
			cwd: fixture.path,
			home: fixture.path,
		});

		await test('Fails on non-Git project', async () => {
			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('The current directory must be a Git repository!');
		});

		const git = await createGit(fixture.path);

		await test('Fails on no staged files', async () => {
			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
		});

		await test('Generates commit message', async () => {
			await git('add', ['data.json']);

			await aicommits([
				'config',
				'set',
				`OPENAI_KEY=${OPENAI_KEY}`,
			]);

			const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusBefore.stdout).toBe('A  data.json');

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

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);
		});

		await test('Accepts --generate flag, overriding config', async () => {
			data.lastName = 'Osame';
			await fixture.writeJson('data.json', data);

			await git('add', ['data.json']);

			const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusBefore.stdout).toBe('M  data.json');

			await aicommits([
				'config',
				'set',
				'generate=4',
			]);

			// Generate flag should override generate config
			const committing = aicommits(['--generate', '2']);

			committing.stdout!.on('data', function onPrompt(buffer: Buffer) {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					const countChoices = stdout.match(/ {2}[●○]/g)?.length ?? 0;

					// 2 choices should be generated
					expect(countChoices).toBe(2);

					committing.stdin!.write('\r');
					committing.stdin!.end();
					committing.stdout?.off('data', onPrompt);
				}
			});

			await committing;

			const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusAfter.stdout).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			await aicommits([
				'config',
				'set',
				'generate=1',
			]);
		});

		await test('Generates Japanese commit message via locale config', async () => {
			// https://stackoverflow.com/a/15034560/911407
			const japanesePattern = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

			data.username = 'privatenumber';
			await fixture.writeJson('data.json', data);

			await git('add', ['data.json']);

			const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusBefore.stdout).toBe('M  data.json');

			await aicommits([
				'config',
				'set',
				'locale=ja',
			]);

			// Generate flag should override generate config
			const committing = aicommits(['--generate', '1']);

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

			const { stdout } = await git('log', ['--oneline']);
			console.log('Committed with:', stdout);

			expect(stdout).toMatch(japanesePattern);
		});

		await fixture.rm();
	});
});
