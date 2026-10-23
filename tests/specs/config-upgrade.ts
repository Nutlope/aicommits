import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, testSuite } from 'manten';
import { getConfig } from '../../src/utils/config-runtime.js';

const withConfigFile = async <T>(contents: string, run: () => Promise<T>) => {
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'aicommits-home-'));
	const originalHome = process.env.HOME;
	const originalProfile = process.env.USERPROFILE;
	await fs.writeFile(path.join(home, '.aicommits'), contents);
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await run();
	} finally {
		process.env.HOME = originalHome;
		process.env.USERPROFILE = originalProfile;
		await fs.rm(home, { recursive: true, force: true });
	}
};

export default testSuite(({ describe }) => {
	describe('config upgrade from v4', async ({ test }) => {
		await test('infers Together from a v4 base URL without a stored provider', async () => {
			const config = await withConfigFile(
				'OPENAI_API_KEY=tgp_test\nOPENAI_BASE_URL=https://api.together.xyz/v1\n',
				() => getConfig()
			);
			expect(config.provider).toBe('togetherai');
		});

		await test('defaults a v4 API-key-only config to OpenAI', async () => {
			const config = await withConfigFile('OPENAI_API_KEY=sk-test\n', () =>
				getConfig()
			);
			expect(config.provider).toBe('openai');
			expect(config.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
		});

		await test('treats an unknown v4 base URL as a custom provider', async () => {
			const config = await withConfigFile(
				'OPENAI_API_KEY=key\nOPENAI_BASE_URL=https://llm.example.com/v1\n',
				() => getConfig()
			);
			expect(config.provider).toBe('custom');
		});

		await test('prefers a stored provider over base URL detection', async () => {
			const config = await withConfigFile(
				'provider=claude-agent\nOPENAI_MODEL=haiku\n',
				() => getConfig()
			);
			expect(config.provider).toBe('claude-agent');
			expect(config.OPENAI_BASE_URL).toBe(undefined);
		});

		await test('reads subscription-detection as a switch', async () => {
			const config = await withConfigFile(
				'subscription-detection=false\n',
				() => getConfig()
			);
			expect(config['subscription-detection']).toBe(false);
		});
	});
});
