import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';

export default testSuite(({ describe }) => {
	describe('Headless mode', ({ test }) => {
		test('setup requires an interactive terminal', async () => {
			const { fixture, aicommits } = await createFixture();

			const { stdout, stderr, exitCode } = await aicommits(['setup'], {
				reject: false,
				env: {
					CI: '1',
				},
			});

			expect(exitCode).toBe(1);
			expect(stdout).toBe('');
			expect(stderr).toMatch('Interactive terminal required for setup');

			await fixture.rm();
		});

		test('model requires an interactive terminal', async () => {
			const { fixture, aicommits } = await createFixture();

			const { stdout, stderr, exitCode } = await aicommits(['model'], {
				reject: false,
				env: {
					CI: '1',
				},
			});

			expect(exitCode).toBe(1);
			expect(stdout).toBe('');
			expect(stderr).toMatch('Interactive terminal required for model selection');

			await fixture.rm();
		});

		test('pr requires an interactive terminal', async () => {
			const { fixture, aicommits } = await createFixture();
			await createGit(fixture.path);

			const { stdout, stderr, exitCode } = await aicommits(['pr'], {
				reject: false,
				env: {
					CI: '1',
				},
			});

			expect(exitCode).toBe(1);
			expect(stdout).toBe('');
			expect(stderr).toMatch('Interactive terminal required for PR creation');

			await fixture.rm();
		});
	});
});
