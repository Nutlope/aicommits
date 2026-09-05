import path from 'path';
import fs from 'fs/promises';
import http from 'node:http';
import { execa, execaNode, type Options } from 'execa';
import {
	createFixture as createFixtureBase,
	type FileTree,
	type FsFixture,
} from 'fs-fixture';

const aicommitsPath = path.resolve('./dist/cli.mjs');

const createAicommits = (fixture: FsFixture) => {
	const homeEnv = {
		HOME: fixture.path, // Linux
		USERPROFILE: fixture.path, // Windows
	};

	return (args?: string[], options?: Options) =>
		execaNode(aicommitsPath, args, {
			cwd: fixture.path,
			...options,
			extendEnv: false,
			env: {
				...homeEnv,
				...options?.env,
			},

			// Block tsx nodeOptions
			nodeOptions: [],
		});
};

export const startAgentServer = async (commitBody: string | null = null) => {
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

export const createGit = async (cwd: string) => {
	const git = (command: string, args?: string[], options?: Options) =>
		execa('git', [command, ...(args || [])], {
			cwd,
			...options,
		});

	await git('init', [
		// In case of different default branch name
		'--initial-branch=master',
	]);

	await git('config', ['user.name', 'name']);
	await git('config', ['user.email', 'email']);

	return git;
};

export const createFixture = async (source?: string | FileTree) => {
	const fixture = await createFixtureBase(source);
	const aicommits = createAicommits(fixture);

	return {
		fixture,
		aicommits,
	};
};

export const files = Object.freeze({
	'.aicommits': `OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`,
	'data.json': Array.from(
		{ length: 10 },
		(_, i) => `${i}. Lorem ipsum dolor sit amet`
	).join('\n'),
});



// See ./diffs/README.md in order to generate diff files
export const getDiff = async (diffName: string): Promise<string> =>
	fs.readFile(new URL(`fixtures/${diffName}`, import.meta.url), 'utf8');
