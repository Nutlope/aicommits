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

			expect(stderr).toMatch(
				'Invalid config property OPENAI_KEY: Must start with "sk-"'
			);
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
				const { stderr } = await aicommits(
					['config', 'set', 'max-length=abc'],
					{
						reject: false,
					}
				);

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

		await describe('base-url', ({ test }) => {
			test('returns default base URL', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				const localConfigPath = path.join(localFixture.path, '.aicommits');
				
				await localAicommits(['config', 'set', openAiToken]);
				const defaultConfig = await localAicommits(['config', 'get', 'base-url']);
				expect(defaultConfig.stdout).toBe('base-url=https://api.openai.com');
				
				await localFixture.rm();
			});

			test('rejects invalid URL format', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				
				const { stderr } = await localAicommits(
					['config', 'set', 'base-url=invalid-url'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch('Must be a valid URL starting with http:// or https://');
				await localFixture.rm();
			});

			test('rejects URL without protocol', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				
				const { stderr } = await localAicommits(
					['config', 'set', 'base-url=api.custom.com'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch('Must be a valid URL starting with http:// or https://');
				await localFixture.rm();
			});

			test('accepts valid HTTPS URL', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				const localConfigPath = path.join(localFixture.path, '.aicommits');
				
				await localAicommits(['config', 'set', openAiToken]);
				const baseUrl = 'base-url=https://api.custom-openai.com';
				await localAicommits(['config', 'set', baseUrl]);

				const configFile = await fs.readFile(localConfigPath, 'utf8');
				expect(configFile).toMatch(baseUrl);

				const get = await localAicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe(baseUrl);
				
				await localFixture.rm();
			});

			test('accepts valid HTTP URL', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				const localConfigPath = path.join(localFixture.path, '.aicommits');
				
				await localAicommits(['config', 'set', openAiToken]);
				const baseUrl = 'base-url=http://localhost:8000';
				await localAicommits(['config', 'set', baseUrl]);

				const configFile = await fs.readFile(localConfigPath, 'utf8');
				expect(configFile).toMatch(baseUrl);

				const get = await localAicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe(baseUrl);
				
				await localFixture.rm();
			});

			test('removes trailing slash from URL', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				
				await localAicommits(['config', 'set', openAiToken]);
				const inputUrl = 'base-url=https://api.custom-openai.com/';
				const expectedUrl = 'base-url=https://api.custom-openai.com';
				
				await localAicommits(['config', 'set', inputUrl]);

				const get = await localAicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe(expectedUrl);
				
				await localFixture.rm();
			});

			test('allows empty value to reset to default', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				
				await localAicommits(['config', 'set', openAiToken]);
				// First set a custom URL
				await localAicommits(['config', 'set', 'base-url=https://custom.api.com']);
				
				// Then reset to default by setting to empty
				await localAicommits(['config', 'set', 'base-url=']);

				const get = await localAicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe('base-url=https://api.openai.com');
				
				await localFixture.rm();
			});

			test('supports Azure OpenAI format URL', async () => {
				const { fixture: localFixture, aicommits: localAicommits } = await createFixture();
				
				await localAicommits(['config', 'set', openAiToken]);
				const baseUrl = 'base-url=https://myresource.openai.azure.com';
				await localAicommits(['config', 'set', baseUrl]);

				const get = await localAicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe(baseUrl);
				
				await localFixture.rm();
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
