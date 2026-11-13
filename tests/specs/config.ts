import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test, describe }) => {
		const { fixture, aicommits } = await createFixture();
		const configPath = path.join(fixture.path, '.aicommits');
		const openAiToken = 'OPENAI_API_KEY=abc';

		test('set unknown config file', async () => {
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set OPENAI_API_KEY', async () => {
			const { stderr } = await aicommits(
				['config', 'set', 'OPENAI_API_KEY=abc'],
				{
					reject: false,
				}
			);

			expect(stderr).toBe('');
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_API_KEY']);
			expect(stdout).toBe('OPENAI_API_KEY=abc****');
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

		await test('rejects removed inline prompt and description config settings', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				for (const assignment of ['prompt=Inline rules', 'description=on']) {
					const result = await aicommits(['config', 'set', assignment], { reject: false });
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toMatch('Invalid config property');
				}
			} finally {
				await fixture.rm();
			}
		});

		await test('rejects malformed assignments without resetting settings', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				await aicommits(['config', 'set', 'locale=zh-CN']);
				const { stderr, exitCode } = await aicommits(['config', 'set', 'locale'], { reject: false });
				expect(exitCode).toBe(1);
				expect(stderr).toMatch('Expected key=value');
				expect((await aicommits(['config', 'get', 'locale'])).stdout).toBe('locale=zh-CN');
			} finally {
				await fixture.rm();
			}
		});

		await test('stores, displays and clears a prompt file without reading it', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				await aicommits(['config', 'set', 'prompt-file=~/prompts/commit.md']);
				expect((await aicommits(['config', 'get', 'prompt-file'])).stdout)
					.toBe('prompt-file=~/prompts/commit.md');
				expect((await aicommits(['config'])).stdout).toMatch('Prompt file: ~/prompts/commit.md');
				await aicommits(['config', 'set', 'prompt-file=']);
				expect(await fs.readFile(path.join(fixture.path, '.aicommits'), 'utf8'))
					.not.toMatch('prompt-file=');
			} finally {
				await fixture.rm();
			}
		});

		await test('ignores obsolete stored prompt settings instead of using them', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				await fs.writeFile(path.join(fixture.path, '.aicommits'), 'prompt=Obsolete instructions\ndescription=on\n');
				expect((await aicommits(['config', 'get', 'prompt', 'description'])).stdout).toBe('');
				expect((await aicommits(['config'])).stdout).not.toMatch('Obsolete instructions');
			} finally {
				await fixture.rm();
			}
		});

		await test('accepts type=custom', async () => {
			const { fixture, aicommits } = await createFixture();
			try {
				await aicommits(['config', 'set', 'type=custom']);
				expect((await aicommits(['config', 'get', 'type'])).stdout).toBe('type=custom');
			} finally {
				await fixture.rm();
			}
		});

		await test('accepts type=conventional+body', async () => {
			await aicommits(['config', 'set', 'OPENAI_API_KEY=abc']);
			await aicommits(['config', 'set', 'type=conventional+body']);
			const { stdout } = await aicommits(['config', 'get', 'type']);
			expect(stdout).toBe('type=conventional+body');
		});

		await test('accepts type=subject+body', async () => {
			await aicommits(['config', 'set', 'OPENAI_API_KEY=abc']);
			await aicommits(['config', 'set', 'type=subject+body']);
			const { stdout } = await aicommits(['config', 'get', 'type']);
			expect(stdout).toBe('type=subject+body');
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
				expect(defaultConfig.stdout).toBe('max-length=72');

				const maxLength = 'max-length=60';
				await aicommits(['config', 'set', maxLength]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(maxLength);

				const get = await aicommits(['config', 'get', 'max-length']);
				expect(get.stdout).toBe(maxLength);
			});
		});

		await describe('max-output-tokens', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(
					['config', 'set', 'max-output-tokens=abc'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be greater than 0', async () => {
				const { stderr } = await aicommits(
					['config', 'set', 'max-output-tokens=0'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch(/must be greater than 0/i);
			});

			test('updates config', async () => {
				const maxOutputTokens = 'max-output-tokens=4096';
				await aicommits(['config', 'set', maxOutputTokens]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(maxOutputTokens);

				const get = await aicommits(['config', 'get', 'max-output-tokens']);
				expect(get.stdout).toBe(maxOutputTokens);
			});
		});

		await describe('thinking', ({ test }) => {
			test('rejects invalid value', async () => {
				const { stderr } = await aicommits(
					['config', 'set', 'thinking=maybe'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch('Must be "enabled" or "disabled"');
			});

			test('defaults to enabled', async () => {
				const { fixture, aicommits } = await createFixture();
				try {
					const get = await aicommits(['config', 'get', 'thinking']);
					expect(get.stdout).toBe('thinking=enabled');
				} finally {
					await fixture.rm();
				}
			});

			test('updates config', async () => {
				const thinking = 'thinking=disabled';
				await aicommits(['config', 'set', thinking]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(thinking);

				const get = await aicommits(['config', 'get', 'thinking']);
				expect(get.stdout).toBe(thinking);
			});
		});

		await fixture.rm();
	});
});
