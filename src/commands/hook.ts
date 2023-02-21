import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { green, red } from 'kolorist';
import { command } from 'cleye';
import { assertGitRepo } from '../utils/git.js';
import { fileExists } from '../utils/fs.js';

export default command({
	name: 'hook',
	parameters: ['<install/uninstall>'],
}, (argv) => {
	const hookPath = fileURLToPath(new URL('test.mjs', import.meta.url));
	const hookName = 'prepare-commit-msg';
	const symlinkPath = `.git/hooks/${hookName}`;

	(async () => {
		await assertGitRepo();

		const { installUninstall } = argv._;

		const hookExists = await fileExists(symlinkPath);
		if (installUninstall === 'install') {
			if (hookExists) {
				const realpath = await fs.realpath(symlinkPath);
				if (realpath === hookPath)	{
					throw new Error('The hook is already installed');
				} else {
					throw new Error(`A different ${hookName} hook seems to be installed. Please remove it before installing aicommits.`);
				}
			}

			await fs.mkdir(path.dirname(symlinkPath), { recursive: true });
			await fs.symlink(hookPath, symlinkPath, 'file');
			await fs.chmod(symlinkPath, 0o755);
			console.log(`${green('✔')} Hook installed`);
			return;
		}

		if (installUninstall === 'uninstall') {
			if (!hookExists) {
				throw new Error('Hook is not installed');
			}
			const realpath = await fs.realpath(symlinkPath);
			if (realpath !== hookPath) {
				throw new Error('Hook is not installed');
			}

			await fs.rm(symlinkPath);
			console.log(`${green('✔')} Hook uninstalled`);
			return;
		}

		throw new Error(`Invalid mode: ${installUninstall}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		process.exit(1); // eslint-disable-line unicorn/no-process-exit
	});
});
