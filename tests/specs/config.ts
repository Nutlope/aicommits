import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { execaNode } from 'execa';

const aicommitsPath = path.resolve('./dist/cli.mjs');

export default testSuite(({ describe }) => {
	describe('config', async ({ test }) => {
		const fixture = await createFixture();
		const env = {
			// Linux
			HOME: fixture.path,

			// Windows
			USERPROFILE: fixture.path,
		};
		const configPath = path.join(fixture.path, '.aicommits');
		const openAiToken = 'OPENAI_KEY=sk-abc';

		test('set unknown config file', async () => {
			const { stderr } = await execaNode(aicommitsPath, ['config', 'set', 'UNKNOWN=1'], {
				env,
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set invalid OPENAI_KEY', async () => {
			const { stderr } = await execaNode(aicommitsPath, ['config', 'set', 'OPENAI_KEY=abc'], {
				env,
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property OPENAI_KEY: Must start with "sk-"');
		});

		await test('set config file', async () => {
			await execaNode(aicommitsPath, ['config', 'set', openAiToken], { env });

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await execaNode(aicommitsPath, ['config', 'get', 'OPENAI_KEY'], { env });

			expect(stdout).toBe(openAiToken);
		});

		await test('reading unknown config', async () => {
			await fs.appendFile(configPath, 'UNKNOWN=1');

			const { stdout, stderr } = await execaNode(aicommitsPath, ['config', 'get', 'UNKNOWN'], {
				env,
				reject: false,
			});

			expect(stdout).toBe('');
			expect(stderr).toBe('');
		});

		await fixture.rm();
	});
});
