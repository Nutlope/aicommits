import path from 'path';
import fs from 'fs/promises';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
} from '../utils.js';
import { getGitHooksPath, getGitDir } from '../../src/utils/git.js';

export default testSuite(({ describe }) => {
	describe('Git hook', ({ test }) => {
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

			const subDir = path.join(fixture.path, 'some-dir');
			const { exitCode } = await aicommits(['hook', 'install'], {
				cwd: subDir,
			});
			expect(exitCode).toBe(0);

			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

			await fixture.rm();
		});

		test('uninstalls hook', async () => {
			const { fixture, aicommits } = await createFixture(files);
			await createGit(fixture.path);

			await aicommits(['hook', 'install']);

			const { stdout } = await aicommits(['hook', 'uninstall']);
			expect(stdout).toMatch('Hook uninstalled');

			const hooksPath = await getGitHooksPath();
			const gitDir = await getGitDir();
			const absoluteHookPath = path.isAbsolute(hooksPath)
				? hooksPath
				: path.resolve(gitDir, hooksPath);
			const hookFilePath = path.join(absoluteHookPath, 'prepare-commit-msg');
			expect(await fixture.exists(hookFilePath)).toBe(false);

			await fixture.rm();
		});

		test('installs hook in git worktree', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			const worktreePath = path.join(fixture.path, 'wt1');
			await git('worktree', ['add', worktreePath]);

			const { stdout } = await aicommits(['hook', 'install'], {
				cwd: worktreePath,
			});
			expect(stdout).toMatch('Hook installed');

			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

			const worktreeGitPath = path.join(worktreePath, '.git');
			const stats = await fs.stat(worktreeGitPath);
			expect(stats.isFile()).toBe(true);

			await fixture.rm();
		});

		test('uninstalls hook from git worktree', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			const worktreePath = path.join(fixture.path, 'wt2');
			await git('worktree', ['add', worktreePath]);
			await aicommits(['hook', 'install'], { cwd: worktreePath });

			const { stdout } = await aicommits(['hook', 'uninstall'], {
				cwd: worktreePath,
			});
			expect(stdout).toMatch('Hook uninstalled');

			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(false);

			await fixture.rm();
		});

		test('installs hook in bare repository', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);

			const barePath = path.join(fixture.path, 'bare.git');
			await git('clone', ['--bare', fixture.path, barePath]);

			const { stdout } = await aicommits(['hook', 'install'], {
				cwd: barePath,
			});
			expect(stdout).toMatch('Hook installed');

			try {
				await fs.access(path.join(barePath, 'hooks', 'prepare-commit-msg'));
			} catch {
				throw new Error('Hook file does not exist in bare repository');
			}

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
