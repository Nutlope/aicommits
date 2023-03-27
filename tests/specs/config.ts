import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { createAicommits } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test }) => {
		const fixture = await createFixture();
		const aicommits = createAicommits(fixture);
		const configPath = path.join(fixture.path, '.aicommits');
		const openAiToken = 'OPENAI_KEY=sk-abc';

		test('set unknown config file', async () => {
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set invalid OPENAI_KEY', async () => {
			const { stderr } = await aicommits(['config', 'set', 'OPENAI_KEY=abc'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property OPENAI_KEY: Must start with "sk-"');
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);

			expect(stdout).toBe(openAiToken);
		});

		await test('reading unknown config', async () => {
			await fs.appendFile(configPath, 'UNKNOWN=1');

			const { stdout, stderr } = await aicommits(['config', 'get', 'UNKNOWN'], {
				reject: false,
			});

			expect(stdout).toBe('');
			expect(stderr).toBe('');
		});

		await fixture.rm();
	});
});
