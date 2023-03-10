import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { createAicommits, createGit } from '../utils.js';

const { OPENAI_KEY } = process.env;
if (!OPENAI_KEY) {
	throw new Error('process.env.OPENAI_KEY is necessary to run these tests');
}

export default testSuite(({ describe }) => {
	if (process.platform === 'win32') {
		// https://github.com/nodejs/node/issues/31409
		console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
		return;
	}

	describe('CLI', async ({ test }) => {
		const fixture = await createFixture({
			'data.json': JSON.stringify({
				firstName: 'Hiroki',
			}),
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

		await test('Commits', async () => {
			await git('add', ['data.json']);

			await aicommits([
				'config',
				'set',
				`OPENAI_KEY=${OPENAI_KEY}`,
			]);

			const statusBefore = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusBefore.stdout).toBe('A  data.json');

			const committing = aicommits();
			committing.stdout!.on('data', (buffer) => {
				const data = buffer.toString();

				if (data.match('Yes /')) {
					committing.stdin!.write('y');
					committing.stdin!.end();
				}
			});

			await committing;

			const statusAfter = await git('status', ['--porcelain', '--untracked-files=no']);
			expect(statusAfter.stdout).toBe('');

			const { stdout } = await git('log', ['--oneline']);
			console.log('Commited with:', stdout);
		});

		await fixture.rm();
	});
});
