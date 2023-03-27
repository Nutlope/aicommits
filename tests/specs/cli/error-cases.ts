import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { createAicommits, createGit } from '../../utils.js';

export default testSuite(({ describe }) => {
	describe('Error cases', async ({ test }) => {
		test('Fails on non-Git project', async () => {
			const fixture = await createFixture();
			const aicommits = createAicommits(fixture);

			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('The current directory must be a Git repository!');
			await fixture.rm();
		});

		test('Fails on no staged files', async () => {
			const fixture = await createFixture();
			const aicommits = createAicommits(fixture);
			await createGit(fixture.path);
			const { stdout, exitCode } = await aicommits([], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found. Make sure to stage your changes with `git add`.');
			await fixture.rm();
		});
	});
});
