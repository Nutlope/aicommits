import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';
import { resolveCommitPrompt } from '../../src/utils/prompt-file.js';

export default testSuite(({ describe }) => {
	describe('prompt files', ({ test }) => {
		test('uses a temporary inline prompt without reading the default file or changing config', async () => {
			const config = { 'prompt-file': 'missing.md' };
			expect(await resolveCommitPrompt(config, undefined, 'Temporary rules')).toBe('Temporary rules');
			expect(await resolveCommitPrompt(config, undefined, '')).toBe('');
			expect(config).toEqual({ 'prompt-file': 'missing.md' });
		});

		test('rejects both temporary prompt inputs instead of silently selecting one', async () => {
			await expect(resolveCommitPrompt({}, 'missing.md', 'Temporary rules'))
				.rejects.toThrow('Use either --prompt or --prompt-file');
		});

		test('preserves formatted content and rereads the file after edits', async () => {
			const { fixture } = await createFixture({ 'commit.md': '# Rules\n\n- `a=b`\n- "quoted"\n' });
			try {
				const config = { 'prompt-file': path.join(fixture.path, 'commit.md') };
				expect(await resolveCommitPrompt(config)).toBe('# Rules\n\n- `a=b`\n- "quoted"\n');
				await fs.writeFile(config['prompt-file'], 'Updated rules');
				expect(await resolveCommitPrompt(config)).toBe('Updated rules');
			} finally {
				await fixture.rm();
			}
		});

		test('resolves saved paths from home and CLI paths from the current directory', async () => {
			const { fixture } = await createFixture({ 'commit rules.md': 'File instructions' });
			try {
				const file = path.join(fixture.path, 'commit rules.md');
				const relativeToHome = path.relative(os.homedir(), file);
				for (const filePath of [relativeToHome, `~/${relativeToHome}`]) {
					expect(await resolveCommitPrompt({ 'prompt-file': filePath })).toBe('File instructions');
				}
				expect(await resolveCommitPrompt(
					{ 'prompt-file': 'missing.md' }, path.relative(process.cwd(), file)
				)).toBe('File instructions');
			} finally {
				await fixture.rm();
			}
		});

		test('leaves built-in instructions alone when no prompt source is selected', async () => {
			expect(await resolveCommitPrompt({})).toBeUndefined();
		});

		test('reports missing, empty and directory paths without falling back to inline instructions', async () => {
			const { fixture } = await createFixture({ 'empty.md': ' \n\t' });
			try {
				for (const [filePath, message] of [
					[path.join(fixture.path, 'missing.md'), 'Cannot read prompt file'],
					[path.join(fixture.path, 'empty.md'), 'Prompt file is empty'],
					[fixture.path, 'Cannot read prompt file'],
				]) {
					await expect(resolveCommitPrompt({ 'prompt-file': filePath })).rejects.toThrow(message);
				}
				await expect(resolveCommitPrompt({}, '')).rejects.toThrow('Prompt file path cannot be empty');
			} finally {
				await fixture.rm();
			}
		});
	});
});
