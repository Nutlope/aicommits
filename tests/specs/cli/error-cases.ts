import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';

export default testSuite(({ describe }) => {
	describe('Error cases', async ({ test }) => {
		test('Fails on non-Git project', async () => {
			const { fixture, aicommits } = await createFixture();
			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('The current directory must be a Git repository!');
			await fixture.rm();
		});

		test('Fails on no staged files', async () => {
			const { fixture, aicommits } = await createFixture();
			await createGit(fixture.path);

			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
			await fixture.rm();
		});
	});
});
