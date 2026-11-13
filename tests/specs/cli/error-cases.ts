import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';

export default testSuite(({ describe }) => {
	describe('Error cases', async ({ test }) => {
		for (const conflict of [false, true]) {
			test(conflict ? 'rejects two temporary prompt sources' : 'requires instructions in custom mode', async () => {
				const { fixture, aicommits } = await createFixture({
					'.aicommits': 'provider=custom\nOPENAI_API_KEY=test-key\nOPENAI_BASE_URL=http://127.0.0.1:1/v1\ntype=custom',
					'data.json': '{}\n',
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					const result = await aicommits(conflict ? ['-p', 'Temporary rules', '--prompt-file', 'missing.md'] : [], { reject: false });
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toMatch(conflict ? 'Use either --prompt or --prompt-file' : 'Custom format requires a non-empty prompt');
				} finally {
					await fixture.rm();
				}
			});
		}

		test('shows prompt file and temporary inline prompt options in help', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				const { stdout } = await aicommits(['--help']);
				expect(stdout).toMatch('--prompt-file');
				expect(stdout).toMatch('--prompt ');
				expect(stdout).toMatch('-p');
				expect(stdout).toMatch('this run only');
				expect(stdout).toMatch('not saved');
			} finally {
				await fixture.rm();
			}
		});

		for (const cli of [false, true]) {
			test(`reports an unreadable ${cli ? 'CLI' : 'configured'} prompt file before calling AI`, async () => {
				const { fixture, aicommits } = await createFixture({
					'.aicommits': 'provider=custom\nOPENAI_API_KEY=test-key\nOPENAI_BASE_URL=http://127.0.0.1:1/v1\nprompt-file=missing.md',
					'data.json': '{}\n',
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					const result = await aicommits(cli ? ['--prompt-file', './missing.md'] : [], { reject: false });
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toMatch('Cannot read prompt file');
					expect(result.stderr).toMatch('missing.md');
					expect(result.stderr).not.toMatch('Bug report');
				} finally {
					await fixture.rm();
				}
			});
		}

		test('Fails on non-Git project', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits': 'OPENAI_API_KEY=sk-test-key\nprovider=openai'
			});
			const { stderr, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stderr).toMatch('The current directory must be a Git repository!');
			await fixture.rm();
		});

		test('Fails on no staged files', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits': 'OPENAI_API_KEY=sk-test-key\nprovider=openai'
			});
			await createGit(fixture.path);

			const { stderr, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stderr).toMatch(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
			await fixture.rm();
		});
	});
});
