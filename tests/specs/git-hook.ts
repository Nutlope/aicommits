import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture, createGit, files } from '../utils.js';
import { execa } from 'execa';

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

		test('Commits', async () => {
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

			await fixture.rm();
		});
	});
});

