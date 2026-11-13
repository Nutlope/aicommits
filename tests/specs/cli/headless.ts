import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
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

		for (const useHook of [false, true]) {
			test(`uses type=custom with a prompt file and preserves grouped bodies in ${useHook ? 'the Git hook' : 'the CLI'}`, async () => {
				const body = '- 自动填充昵称\n\nfix(home): 修复加载状态\n\n- 复用缓存';
				const agentServer = await startAgentServer(body);
				const { fixture, aicommits } = await createFixture({
					'.aicommits': [
						'OPENAI_API_KEY=test-key',
						`OPENAI_BASE_URL=${agentServer.baseUrl}`,
						'OPENAI_MODEL=test-model',
						'type=custom',
						'prompt-file=~/commit.md',
					].join('\n'),
					'commit.md': 'GROUP_EACH_FEATURE_WITH_ITS_OWN_DETAILS',
					'data.json': '{}\n',
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					let output: string;
					if (useHook) {
						await aicommits(['hook', 'install']);
						await git('commit', ['--no-edit'], { env: { CI: '1', HOME: fixture.path, USERPROFILE: fixture.path } });
						output = (await git('log', ['-1', '--pretty=%B'])).stdout;
					} else {
						output = (await aicommits([], { env: { CI: '1' } })).stdout;
					}
					expect(output.trim()).toBe(`feat: add test data\n\n${body}`);
					expect(agentServer.requests[0]).toMatch('GROUP_EACH_FEATURE_WITH_ITS_OWN_DETAILS');
					expect(agentServer.requests[0]).not.toMatch('Format: plain text');
					expect(agentServer.requests[0]).not.toMatch('Return a concise, non-empty body');
					expect(agentServer.requests[0]).not.toMatch('Return no body.');
				} finally {
					await agentServer.close();
					await fixture.rm();
				}
			});
		}

		for (const useHook of [false, true]) {
			test(`reads a multiline prompt file in ${useHook ? 'the Git hook' : 'the CLI'}`, async () => {
				const agentServer = await startAgentServer();
				const prompt = '# Commit rules\n\n- Preserve `a=b` and "quotes"\n- FILE_PROMPT_SENTINEL\n';
				const { fixture, aicommits } = await createFixture({
					'.aicommits': [
						'OPENAI_API_KEY=test-key',
						`OPENAI_BASE_URL=${agentServer.baseUrl}`,
						'OPENAI_MODEL=test-model',
						'prompt-file=~/commit rules.md',
					].join('\n'),
					'commit rules.md': prompt,
					'data.json': '{}\n',
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					if (useHook) {
						await aicommits(['hook', 'install']);
						await git('commit', ['--no-edit'], { env: { CI: '1', HOME: fixture.path, USERPROFILE: fixture.path } });
					} else {
						await aicommits([], { env: { CI: '1' } });
					}
					const request = JSON.parse(agentServer.requests[0]);
					expect(request.messages.some((message: { content: string }) => message.content.includes(prompt))).toBe(true);
					expect(agentServer.requests[0]).toMatch('Format: plain text');
				} finally {
					await agentServer.close();
					await fixture.rm();
				}
			});
		}

		for (const flag of ['--prompt', '-p']) {
				test(`${flag} temporarily overrides the default file without updating config`, async () => {
				const agentServer = await startAgentServer();
				const { fixture, aicommits } = await createFixture({
					'.aicommits': [
						'OPENAI_API_KEY=test-key',
						`OPENAI_BASE_URL=${agentServer.baseUrl}`,
						'OPENAI_MODEL=test-model',
						'prompt-file=missing.md',
					].join('\n'),
					'data.json': '{}\n',
				});
				try {
					const git = await createGit(fixture.path);
					await git('add', ['data.json']);
					const configPath = path.join(fixture.path, '.aicommits');
					const before = await fs.readFile(configPath, 'utf8');
					await aicommits([flag, 'CLI_PROMPT_SENTINEL'], { env: { CI: '1' } });
					expect(agentServer.requests[0]).toMatch('CLI_PROMPT_SENTINEL');
					expect(await fs.readFile(configPath, 'utf8')).toBe(before);
				} finally {
					await agentServer.close();
					await fixture.rm();
				}
			});
		}

		test('CLI prompt file replaces the configured file and reads edits on the next run', async () => {
			const agentServer = await startAgentServer();
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
					'prompt-file=missing.md',
				].join('\n'),
				'override.md': 'CLI_FILE_SENTINEL',
				'data.json': '{}\n',
			});
			try {
				const git = await createGit(fixture.path);
				await git('add', ['data.json']);
				await aicommits(['--prompt-file', './override.md'], { env: { CI: '1' } });
				expect(agentServer.requests[0]).toMatch('CLI_FILE_SENTINEL');
				await fs.writeFile(path.join(fixture.path, 'override.md'), 'EDITED_FILE_SENTINEL');
				await aicommits(['--prompt-file=./override.md'], { env: { CI: '1' } });
				expect(agentServer.requests[1]).toMatch('EDITED_FILE_SENTINEL');
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
