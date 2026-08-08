import { expect, testSuite } from 'manten';
import http from 'node:http';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

const makeResponse = (
	overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
	id: 'chatcmpl-test',
	object: 'chat.completion',
	created: 1234567890,
	model: 'test-model',
	choices: [
		{
			index: 0,
			message: { role: 'assistant', content: 'fix: test commit' },
			finish_reason: 'stop',
		},
	],
	usage: {
		prompt_tokens: 10,
		completion_tokens: 5,
		total_tokens: 15,
	},
	...overrides,
});

const startServer = (
	handler: (body: string) => Record<string, unknown>
): Promise<{
	server: http.Server;
	url: string;
	lastRequest: () => { method: string; path: string; body: string } | null;
}> => {
	let lastReq: { method: string; path: string; body: string } | null = null;
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk: Buffer) => {
			body += chunk;
		});
		req.on('end', () => {
			lastReq = {
				method: req.method as string,
				path: req.url ?? '',
				body,
			};
			if (req.url === '/v1/models') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({ data: [{ id: 'test-model', object: 'model' }] })
				);
				return;
			}
			if (req.url === '/v1/chat/completions') {
				const response = handler(body);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(response));
				return;
			}
			res.writeHead(404);
			res.end('Not found');
		});
	});

	return new Promise((resolve) => {
		// port 0 = OS picks a free port
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({
				server,
				url: `http://localhost:${port}/v1`,
				lastRequest: () => lastReq,
			});
		});
	});
};

const makeModel = (baseURL: string) => {
	const provider = createOpenAICompatible({
		name: 'test',
		apiKey: 'sk-test',
		baseURL,
	});
	return provider('test-model');
};

const close = (server: http.Server) =>
	new Promise<void>((resolve) => server.close(() => resolve()));

export default testSuite(({ describe }) => {
	describe('OpenAI-compatible response parsing', ({ test }) => {
		test('parses a standard OpenAI response', async () => {
			const srv = await startServer(() => makeResponse());
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('fix: test commit');
			} finally {
				await close(srv.server);
			}
		});

		test('parses response with role "model" instead of "assistant"', async () => {
			const srv = await startServer(() =>
				makeResponse({
					choices: [
						{
							index: 0,
							message: { role: 'model', content: 'fix: compat response' },
							finish_reason: 'stop',
						},
					],
				})
			);
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('fix: compat response');
			} finally {
				await close(srv.server);
			}
		});

		test('sends stream: false in doGenerate requests', async () => {
			const srv = await startServer(() => makeResponse());
			try {
				const model = makeModel(srv.url);
				await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				const req = srv.lastRequest();
				expect(req).not.toBeNull();
				const parsed = JSON.parse(req!.body);
				expect(parsed.stream).toBe(false);
			} finally {
				await close(srv.server);
			}
		});

		test('accepts response with extra fields in choice object', async () => {
			const srv = await startServer(() =>
				makeResponse({
					choices: [
						{
							index: 0,
							message: { role: 'assistant', content: 'fix: extra fields' },
							finish_reason: 'stop',
							logprobs: null,
							alpha: 42,
						},
					],
				})
			);
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('fix: extra fields');
			} finally {
				await close(srv.server);
			}
		});

		test('accepts response with missing optional fields', async () => {
			const srv = await startServer(() => ({
				choices: [
					{
						message: { role: 'assistant', content: 'fix: minimal' },
					},
				],
			}));
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('fix: minimal');
			} finally {
				await close(srv.server);
			}
		});

		test('accepts response with null content', async () => {
			const srv = await startServer(() =>
				makeResponse({
					choices: [
						{
							index: 0,
							message: { role: 'assistant', content: null },
							finish_reason: 'stop',
						},
					],
				})
			);
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('');
			} finally {
				await close(srv.server);
			}
		});

		test('accepts response with extra fields in message', async () => {
			const srv = await startServer(() =>
				makeResponse({
					choices: [
						{
							index: 0,
							message: {
								role: 'assistant',
								content: 'fix: extended message',
								refusal: null,
							},
							finish_reason: 'stop',
						},
					],
				})
			);
			try {
				const model = makeModel(srv.url);
				const result = await generateText({
					model,
					prompt: 'test',
					maxOutputTokens: 50,
				});
				expect(result.text).toBe('fix: extended message');
			} finally {
				await close(srv.server);
			}
		});
	});
});
