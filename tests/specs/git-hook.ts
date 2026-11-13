import path from 'path';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
} from '../utils.js';
import { isCalledFromGitHook } from '../../src/commands/hook.js';

export default testSuite(({ describe }) => {
	describe('Git hook', ({ test }) => {
		for (const noEdit of [false, true]) {
			test(`keeps every line of custom candidates commented (${noEdit ? 'no editor' : 'editor'})`, async () => {
				const message = {
					subject: 'feat: add greetings',
					body: '- Add a greeting\n\nfix: handle empty names\n- Use a default name',
				};
				// Use Node as a local Codex protocol fixture; no login or HTTP server.
				const { fixture, aicommits } = await createFixture({
					'.aicommits': [
						'provider=codex',
						`codex-path=${process.execPath}`,
						'type=custom',
						'generate=2',
						'prompt-file=commit.md',
					].join('\n'),
					'commit.md': 'Group each feature with its own title and details.',
					'data.json': '{}\n',
					exec: [
						'process.stdin.resume();',
						'process.stdin.on("end", () => {',
						`const events = ${JSON.stringify([
							{ type: 'thread.started', thread_id: 'fixture' },
							{ type: 'turn.started' },
							{ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: JSON.stringify(message) } },
							{ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } },
						])};`,
						'for (const event of events) console.log(JSON.stringify(event));',
						'});',
					].join('\n'),
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					await aicommits(['hook', 'install']);
					const result = await git('commit', [
						'--cleanup=strip', ...(noEdit ? ['--no-edit'] : []),
					], {
						reject: false,
						env: { HOME: fixture.path, USERPROFILE: fixture.path, GIT_EDITOR: 'true', CI: '1' },
					});
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toMatch('empty commit message');
				} finally {
					await fixture.rm();
				}
			});
		}

		test('recognizes hook paths across platforms', () => {
			expect(isCalledFromGitHook('/repo/.git/hooks/prepare-commit-msg')).toBe(
				true
			);
			expect(isCalledFromGitHook('C:\\repo\\hooks\\prepare-commit-msg')).toBe(
				true
			);
			expect(isCalledFromGitHook('/repo/hooks/pre-commit')).toBe(false);
		});

		test('errors when not in Git repo', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const { exitCode, stderr } = await aicommits(['hook', 'install'], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(stderr).toMatch('The current directory must be a Git repository');

			await fixture.rm();
		});

		test('installs from Git repo subdirectory', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'some-dir': {
					'file.txt': '',
				},
			});
			await createGit(fixture.path);

			const { stdout } = await aicommits(['hook', 'install'], {
				cwd: path.join(fixture.path, 'some-dir'),
			});
			expect(stdout).toMatch('Hook installed');

			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

			await fixture.rm();
		});

		test('installs and uninstalls from a linked worktree', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial', '--no-verify']);
			const worktreePath = path.join(fixture.path, 'linked-worktree');
			await git('worktree', ['add', '--detach', worktreePath]);

			const { stdout: installOutput } = await aicommits(['hook', 'install'], {
				cwd: worktreePath,
			});
			expect(installOutput).toMatch('Hook installed');
			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

			const { stdout: uninstallOutput } = await aicommits(
				['hook', 'uninstall'],
				{ cwd: worktreePath }
			);
			expect(uninstallOutput).toMatch('Hook uninstalled');
			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(false);

			await fixture.rm();
		});

		test('Commits', async () => {
			if (!process.env.OPENAI_API_KEY) {
				console.warn(
					'⚠️  process.env.OPENAI_API_KEY is necessary to run this test. Skipping...'
				);
				return;
			}
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			const { stdout } = await aicommits(['hook', 'install']);
			expect(stdout).toMatch('Hook installed');

			await git('add', ['data.json']);
			await git('commit', ['--no-edit'], {
				env: {
					HOME: fixture.path,
					USERPROFILE: fixture.path,
				},
			});

			const { stdout: commitMessage } = await git('log', ['--pretty=%B']);
			console.log('Committed with:', commitMessage);
			expect(commitMessage.startsWith('# ')).not.toBe(true);

			await fixture.rm();
		});
	});
});
