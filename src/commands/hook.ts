import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { green, red } from 'kolorist';
import { command } from 'cleye';
import { assertGitRepo } from '../utils/git.js';
import { fileExists } from '../utils/fs.js';
import { KnownError, handleCliError } from '../utils/error.js';

const hookName = 'prepare-commit-msg';
const symlinkPath = `.git/hooks/${hookName}`;

console.log('process.argv', process.argv);
export const isCalledFromGitHook = process.argv[1].endsWith(`/${symlinkPath}`);

const isWindows = process.platform === 'win32';
const windowsHook = (hookPath: string) => `
#!/usr/bin/env node
import(${JSON.stringify(path.relative(path.resolve(symlinkPath), hookPath))})
`.replace(/^\s+/gm, '').trim();

export default command({
	name: 'hook',
	parameters: ['<install/uninstall>'],
}, (argv) => {
	const hookPath = fileURLToPath(new URL('cli.mjs', import.meta.url));

	(async () => {
		await assertGitRepo();

		const { installUninstall: mode } = argv._;

		const hookExists = await fileExists(symlinkPath);
		if (mode === 'install') {
			if (hookExists) {
				// If the symlink is broken, it will throw an error
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				const realpath = await fs.realpath(symlinkPath).catch(() => {});
				if (realpath === hookPath) {
					console.warn('The hook is already installed');
					return;
				}
				throw new KnownError(`A different ${hookName} hook seems to be installed. Please remove it before installing aicommits.`);
			}

			await fs.mkdir(path.dirname(symlinkPath), { recursive: true });

			if (isWindows) {
				const asdf = windowsHook(hookPath);
				console.log({
					asdf,
					symlinkPath,
					resolvedSymLinkPath: path.resolve(symlinkPath),
					hookPath,
				});
				await fs.writeFile(
					symlinkPath,
					asdf,
				);
			} else {
				await fs.symlink(hookPath, symlinkPath, 'file');
				await fs.chmod(symlinkPath, 0o755);
			}
			console.log(`${green('✔')} Hook installed`);
			return;
		}

		if (mode === 'uninstall') {
			if (!hookExists) {
				console.warn('Hook is not installed');
				return;
			}

			if (isWindows) {
				const scriptContent = await fs.readFile(symlinkPath, 'utf8');
				if (scriptContent !== windowsHook(hookPath)) {
					console.warn('Hook is not installed');
					return;
				}
			} else {
				const realpath = await fs.realpath(symlinkPath);
				if (realpath !== hookPath) {
					console.warn('Hook is not installed');
					return;
				}
			}

			await fs.rm(symlinkPath);
			console.log(`${green('✔')} Hook uninstalled`);
			return;
		}

		throw new KnownError(`Invalid mode: ${mode}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
});
