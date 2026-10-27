import { testSuite, expect } from 'manten';
import { createFixture, createGit, startAgentServer } from '../../utils.js';

const rpc = (id: number, method: string, params: unknown) =>
	JSON.stringify({ jsonrpc: '2.0', id, method, params });

const notification = (method: string) =>
	JSON.stringify({ jsonrpc: '2.0', method });

type RpcResponse = {
	id?: number;
	result?: any;
	error?: { message: string };
};

const initializeRequest = rpc(1, 'initialize', {
	protocolVersion: '2025-06-18',
	capabilities: {},
	clientInfo: { name: 'test-client', version: '0.0.0' },
});

// Buffers newline-delimited JSON-RPC responses from stdout and resolves once
// every expected response id has been received (stdout may split mid-line).
const readResponses = (
	stdout: NodeJS.ReadableStream,
	expectedIds: number[],
	timeoutMs = 30_000
) =>
	new Promise<Map<number, RpcResponse>>((resolve, reject) => {
		const responses = new Map<number, RpcResponse>();
		let buffer = '';
		const failTimer = setTimeout(() => {
			reject(
				new Error(
					`Timed out waiting for MCP responses (got ${[...responses.keys()]}, expected ${expectedIds})`
				)
			);
		}, timeoutMs);

		const finish = () => {
			clearTimeout(failTimer);
			resolve(responses);
		};

		stdout.setEncoding('utf8');
		stdout.on('data', (chunk: string) => {
			buffer += chunk;
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) continue;
				let parsed: RpcResponse;
				try {
					parsed = JSON.parse(line);
				} catch {
					reject(new Error(`Non-JSON line on stdout: ${line}`));
					clearTimeout(failTimer);
					return;
				}
				if (parsed.id !== undefined) {
					responses.set(parsed.id, parsed);
					if (expectedIds.every((id) => responses.has(id))) finish();
				}
			}
		});
		stdout.on('end', () => {
			clearTimeout(failTimer);
			reject(
				new Error(
					`MCP server exited before responding (got ${[...responses.keys()]}, expected ${expectedIds})`
				)
			);
		});
	});

export default testSuite(({ describe }) => {
	describe('MCP server', ({ test }) => {
		test('lists the generate_commit_message tool', async () => {
			const { fixture, aicommits } = await createFixture();

			const child = aicommits(['mcp']);
			const pending = readResponses(child.stdout!, [1, 2]);
			child.stdin!.write(
				[
					initializeRequest,
					notification('notifications/initialized'),
					rpc(2, 'tools/list', {}),
				].join('\n') + '\n'
			);
			const responses = await pending;
			child.kill();
			await child.catch(() => {});

			expect(responses.get(1)!.result.serverInfo.name).toBe('aicommits');

			const tools = responses.get(2)!.result.tools;
			expect(tools.length).toBe(1);
			expect(tools[0].name).toBe('generate_commit_message');
			const properties = tools[0].inputSchema.properties;
			expect(properties.context).toBeDefined();
			expect(properties.type).toBeDefined();
			expect(properties.count).toBeDefined();
			expect(properties.exclude).toBeDefined();

			await fixture.rm();
		});

		test('generates a message with context without committing', async () => {
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
				const child = aicommits(['mcp']);
				const pending = readResponses(child.stdout!, [1, 2]);
				child.stdin!.write(
					[
						initializeRequest,
						notification('notifications/initialized'),
						rpc(2, 'tools/call', {
							name: 'generate_commit_message',
							arguments: {
								context: 'Refactoring the auth flow',
								type: 'conventional',
							},
						}),
					].join('\n') + '\n'
				);
				const responses = await pending;
				child.kill();
				await child.catch(() => {});

				const result = responses.get(2)!.result;
				expect(result.isError).toBeUndefined();
				expect(result.content[0].type).toBe('text');
				expect(result.content[0].text).toBe('feat: add test data');
				expect(agentServer.requests.length).toBe(1);
				expect(agentServer.requests[0]).toMatch('Refactoring the auth flow');

				const logResult = await git('log', [], { reject: false });
				expect(logResult.failed).toBe(true);
				expect(logResult.stderr).toMatch('does not have any commits yet');
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('generates multiple variants with count', async () => {
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
				const child = aicommits(['mcp']);
				const pending = readResponses(child.stdout!, [1, 2]);
				child.stdin!.write(
					[
						initializeRequest,
						notification('notifications/initialized'),
						rpc(2, 'tools/call', {
							name: 'generate_commit_message',
							arguments: { count: 2 },
						}),
					].join('\n') + '\n'
				);
				const responses = await pending;
				child.kill();
				await child.catch(() => {});

				const result = responses.get(2)!.result;
				expect(result.isError).toBeUndefined();
				expect(result.content[0].text).toBe('feat: add test data');
				expect(agentServer.requests.length).toBe(2);
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('returns a tool error when nothing is staged', async () => {
			const agentServer = await startAgentServer();
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'OPENAI_API_KEY=test-key',
					`OPENAI_BASE_URL=${agentServer.baseUrl}`,
					'OPENAI_MODEL=test-model',
				].join('\n'),
				'data.json': '{"agentic":true}\n',
			});
			await createGit(fixture.path);

			try {
				const child = aicommits(['mcp']);
				const pending = readResponses(child.stdout!, [1, 2]);
				child.stdin!.write(
					[
						initializeRequest,
						notification('notifications/initialized'),
						rpc(2, 'tools/call', {
							name: 'generate_commit_message',
							arguments: {},
						}),
					].join('\n') + '\n'
				);
				const responses = await pending;
				child.kill();
				await child.catch(() => {});

				const result = responses.get(2)!.result;
				expect(result.isError).toBe(true);
				expect(result.content[0].text).toMatch('No staged changes found');
			} finally {
				await agentServer.close();
				await fixture.rm();
			}
		});

		test('returns a tool error when not configured', async () => {
			const { fixture, aicommits } = await createFixture({
				'data.json': '{"agentic":true}\n',
			});
			const git = await createGit(fixture.path);
			await git('add', ['data.json']);

			try {
				const child = aicommits(['mcp']);
				const pending = readResponses(child.stdout!, [1, 2]);
				child.stdin!.write(
					[
						initializeRequest,
						notification('notifications/initialized'),
						rpc(2, 'tools/call', {
							name: 'generate_commit_message',
							arguments: {},
						}),
					].join('\n') + '\n'
				);
				const responses = await pending;
				child.kill();
				await child.catch(() => {});

				const result = responses.get(2)!.result;
				expect(result.isError).toBe(true);
				expect(result.content[0].text).toMatch('setup');
			} finally {
				await fixture.rm();
			}
		});
	});
});