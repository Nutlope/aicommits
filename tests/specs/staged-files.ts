import { expect, testSuite } from 'manten';
import { createFixture, createGit } from '../utils.js';
import {
	parseStagedFiles,
	formatStagedFile,
	formatStagedStatusSummary,
} from '../../src/utils/staged-files.js';

export default testSuite(({ test }) => {
	test('reads staged statuses, including rename paths, from real Git output', async () => {
		const { fixture } = await createFixture({
			'updated.txt': 'before\n',
			'deleted.txt': 'delete me\n',
			'old name.txt': 'rename this unique content\n',
		});
		try {
			const git = await createGit(fixture.path);
			await git('add', ['.']);
			await git('commit', ['-m', 'initial']);
			await fixture.writeFile('updated.txt', 'after\n');
			await fixture.writeFile('新增 文件.txt', 'new\n');
			await git('rm', ['deleted.txt']);
			await git('mv', ['old name.txt', 'new name.txt']);
			await git('add', ['.']);
			// A later working-tree edit must not change the staged classification.
			await fixture.writeFile('新增 文件.txt', 'unstaged edit\n');
			const { stdout } = await git('diff', [
				'--cached', '--name-status', '-z', '--find-renames',
			]);
			const files = parseStagedFiles(stdout);
			expect(files).toEqual([
				{ status: 'D', path: 'deleted.txt' },
				{ status: 'R', path: 'new name.txt', originalPath: 'old name.txt' },
				{ status: 'M', path: 'updated.txt' },
				{ status: 'A', path: '新增 文件.txt' },
			]);
			expect(files.map(formatStagedFile)).toEqual([
				'[-] deleted.txt',
				'[r] old name.txt → new name.txt',
				'[m] updated.txt',
				'[+] 新增 文件.txt',
			]);
			expect(formatStagedStatusSummary(files)).toBe('+1 | m1 | -1 | r1');
		} finally {
			await fixture.rm();
		}
	});

	test('preserves unusual paths and handles copies without shifting later records', () => {
		const files = parseStagedFiles('C100\0source.txt\0copy.txt\0A\0line\nbreak.txt\0M\0 spaced.txt \0');
		expect(files).toEqual([
			{ status: 'C', originalPath: 'source.txt', path: 'copy.txt' },
			{ status: 'A', path: 'line\nbreak.txt' },
			{ status: 'M', path: ' spaced.txt ' },
		]);
		expect(formatStagedFile(files[1])).toBe('[+] "line\\nbreak.txt"');
		expect(parseStagedFiles('')).toEqual([]);
	});
});
