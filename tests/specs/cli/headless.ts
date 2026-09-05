import { testSuite, expect } from 'manten';
import { createFixture, createGit, startAgentServer } from '../../utils.js';

export default testSuite(({ describe }) => {
	describe('Headless mode', ({ test }) => {
		test('generates a one-shot message for a custom provider', async () => {
			const agentServer = await startAgentServer();
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
				].join('\n'),
				'data.json': '{"agentic":true}\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['data.json']);

			try {
				const { stdout, exitCode } = await aicommits([], {
					reject: false,
					env: { CI: '1' },
				});

				expect(exitCode).toBe(0);
				expect(stdout).toBe('feat: add test data');
				expect(agentServer.requests.length).toBe(1);
				expect(agentServer.requests[0]).toMatch('agentic');
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('includes a description when requested', async () => {
			const agentServer = await startAgentServer(
				'Explain the important implementation context.'
			);
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
				].join('\n'),
				'data.json': '{"agentic":true}\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['data.json']);

			try {
				const { stdout, exitCode } = await aicommits(['--description'], {
					reject: false,
					env: { CI: '1' },
				});

				expect(exitCode).toBe(0);
				expect(stdout).toBe(
					'feat: add test data\n\nExplain the important implementation context.'
				);
				expect(agentServer.requests[0]).toMatch(
					'Return a concise, non-empty body'
				);
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('preserves conventional+body config on the agentic generator', async () => {
			const agentServer = await startAgentServer('Explain the conventional change.');
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
					'type=conventional+body',
					'generate=2',
				].join('\n'),
				'data.json': '{"agentic":true}\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['data.json']);

			try {
				const { stdout, exitCode } = await aicommits([], {
					reject: false,
					env: { CI: '1' },
				});

				expect(exitCode).toBe(0);
				expect(stdout).toBe(
					'feat: add test data\n\nExplain the conventional change.'
				);
				expect(agentServer.requests[0]).toMatch('Conventional Commits');
				expect(agentServer.requests[0]).toMatch(
					'Return a concise, non-empty body'
				);
				expect(agentServer.requests.length).toBe(1);
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('preserves subject+body config on the agentic generator', async () => {
			const agentServer = await startAgentServer('Explain the plain subject change.');
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
					'type=subject+body',
				].join('\n'),
				'data.json': '{"agentic":true}\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['data.json']);

			try {
				const { stdout, exitCode } = await aicommits([], {
					reject: false,
					env: { CI: '1' },
				});

				expect(exitCode).toBe(0);
				expect(stdout).toBe(
					'feat: add test data\n\nExplain the plain subject change.'
				);
				expect(agentServer.requests[0]).toMatch('Format: plain text');
				expect(agentServer.requests[0]).toMatch(
					'Return a concise, non-empty body'
				);
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

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
