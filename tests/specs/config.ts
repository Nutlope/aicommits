import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test, describe }) => {
		const { fixture, aicommits } = await createFixture();
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

		await describe('timeout', ({ test }) => {
			test('setting invalid timeout config', async () => {
				const { stderr } = await aicommits(['config', 'set', 'timeout=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('setting valid timeout config', async () => {
				const timeout = 'timeout=20000';
				await aicommits(['config', 'set', timeout]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(timeout);

				const get = await aicommits(['config', 'get', 'timeout']);
				expect(get.stdout).toBe(timeout);
			});
		});

		await describe('max-length', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(['config', 'set', 'max-length=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be at least 20 characters', async () => {
				const { stderr } = await aicommits(['config', 'set', 'max-length=10'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be greater than 20 characters/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'max-length']);
				expect(defaultConfig.stdout).toBe('max-length=50');

				const maxLength = 'max-length=60';
				await aicommits(['config', 'set', maxLength]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(maxLength);

				const get = await aicommits(['config', 'get', 'max-length']);
				expect(get.stdout).toBe(maxLength);
			});
		});

		await describe('auto-push-current-branch', ({ test }) => {
			test('must be a boolean', async () => {
				const { stderr } = await aicommits(['config', 'set', 'auto-push-current-branch=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be a boolean');
			});

			test('updates config auto-push-current-branch', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'auto-push-current-branch']);

				expect(defaultConfig.stdout).toBe('auto-push-current-branch=false');
				const autoPushCurrentBranch = 'auto-push-current-branch=true';
				await aicommits(['config', 'set', autoPushCurrentBranch]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(autoPushCurrentBranch);

				const get = await aicommits(['config', 'get', 'auto-push-current-branch']);
				expect(get.stdout).toBe(autoPushCurrentBranch);
			});
		});

		await describe('ask-push-current-branch', ({ test }) => {
			test('must be a boolean', async () => {
				const { stderr } = await aicommits(['config', 'set', 'ask-push-current-branch=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be a boolean');
			});

			test('updates config ask-push-current-branch', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'ask-push-current-branch']);

				expect(defaultConfig.stdout).toBe('ask-push-current-branch=false');
				const askPushCurrentBranch = 'ask-push-current-branch=true';
				await aicommits(['config', 'set', askPushCurrentBranch]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(askPushCurrentBranch);

				const get = await aicommits(['config', 'get', 'ask-push-current-branch']);
				expect(get.stdout).toBe(askPushCurrentBranch);
			});
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

		await fixture.rm();
	});
});
