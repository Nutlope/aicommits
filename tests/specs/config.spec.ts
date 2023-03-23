import fs from 'fs/promises';
import path from 'path';
import { createFixture } from 'fs-fixture';
import {
	describe, it, beforeAll,
} from 'vitest';
import { createAicommits } from '../utils.js';

const { OPENAI_KEY } = process.env;

describe('config', () => {
	beforeAll(async () => {
		if (!OPENAI_KEY) {
			console.warn(
				'⚠️  process.env.OPENAI_KEY is necessary to run these tests. Skipping...',
			);
		}
	});

	it.concurrent('set unknown config file', async ({ expect }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits({
			home: fixture.path,
		});

		const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
			reject: false,
		});

		expect(stderr).toMatch('Invalid config property: UNKNOWN');
	});

	it.concurrent('set invalid OPENAI_KEY', async ({ expect }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits({
			home: fixture.path,
		});

		const { stderr } = await aicommits(['config', 'set', 'OPENAI_KEY=abc'], {
			reject: false,
		});

		expect(stderr).toMatch(
			'Invalid config property OPENAI_KEY: Must start with "sk-"',
		);
	});

	it.concurrent('set config file', async ({ expect }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits({
			home: fixture.path,
		});
		const configPath = path.join(fixture.path, '.aicommits');

		const config = `OPENAI_KEY=${OPENAI_KEY}`;
		await aicommits(['config', 'set', config]);

		const configFile = await fs.readFile(configPath, 'utf8');
		expect(configFile).toMatch(config);
	});

	it.concurrent('get config file', async ({ expect }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits({
			home: fixture.path,
		});

		const config = `OPENAI_KEY=${OPENAI_KEY}`;

		await aicommits(['config', 'set', config]);
		const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);
		expect(stdout).toBe(config);
	});

	it.concurrent('reading unknown config', async ({ expect }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits({
			home: fixture.path,
		});
		const configPath = path.join(fixture.path, '.aicommits');

		const config = `OPENAI_KEY=${OPENAI_KEY}`;
		await aicommits(['config', 'set', config]);

		await fs.appendFile(configPath, 'UNKNOWN=1');

		const { stdout, stderr } = await aicommits(['config', 'get', 'UNKNOWN'], {
			reject: false,
		});

		expect(stdout).toBe('');
		expect(stderr).toBe('');
	});
});
