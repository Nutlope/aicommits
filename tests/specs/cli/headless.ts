import http from 'node:http';
import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';

const startAgentServer = async (commitBody: string | null = null) => {
	const requests: string[] = [];
	const server = http.createServer(async (request, response) => {
		let requestBody = '';
		for await (const chunk of request) requestBody += chunk;
		requests.push(requestBody);

		const message = {
			role: 'assistant',
			content: commitBody
				? `feat: add test data\n\n${commitBody}`
				: 'feat: add test data',
		};

		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				id: `response-${requests.length}`,
				object: 'chat.completion',
				created: 0,
				model: 'test-model',
				choices: [
					{
						index: 0,
						message,
						finish_reason: 'tool_calls',
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			})
		);
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Server did not start');

	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};

export default testSuite(({ describe }) => {
	describe('Headless mode', ({ test }) => {
		test('generates a one-shot message for a custom provider', async () => {
			const agentServer = await startAgentServer();
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
					'PROVIDER_OPTIONS={"custom":{"customOption":"value"}}',
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
				expect(JSON.parse(agentServer.requests[0]).customOption).toBe('value');
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
