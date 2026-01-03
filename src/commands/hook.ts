import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { green, red } from 'kolorist';
import { command } from 'cleye';
import { getGitHooksPath, getGitDir } from '../utils/git.js';
import { fileExists } from '../utils/fs.js';
import { KnownError, handleCliError } from '../utils/error.js';

const hookName = 'prepare-commit-msg';

const hookPath = fileURLToPath(new URL('cli.mjs', import.meta.url));

export const isCalledFromGitHook = () => {
	const scriptPath = process.argv[1].replace(/\\/g, '/');
	return scriptPath.endsWith(hookName) || scriptPath.includes('/hooks/');
};

const isWindows = process.platform === 'win32';
const windowsHook = `
#!/usr/bin/env node
import(${JSON.stringify(pathToFileURL(hookPath))})
`.trim();

export default command(
	{
		name: 'hook',
		description: 'Install or uninstall the Git hook for automatic commit messages',
		help: {
			description: 'Install or uninstall the Git hook for automatic commit messages',
		},
		parameters: ['<install/uninstall>'],
	},
	(argv) => {
		(async () => {
			const gitDir = await getGitDir();
			const hooksPath = await getGitHooksPath();
			const { installUninstall: mode } = argv._;

			let absoluteHookPath: string;
			if (path.isAbsolute(hooksPath)) {
				absoluteHookPath = hooksPath;
			} else {
				absoluteHookPath = path.resolve(hooksPath);
			}

			const absoluteSymlinkPath = path.join(absoluteHookPath, hookName);
			const hookExists = await fileExists(absoluteSymlinkPath);
			if (mode === 'install') {
				if (hookExists) {
					const realpath = await fs
						.realpath(absoluteSymlinkPath)
						.catch(() => {});
					if (realpath === hookPath) {
						console.warn('The hook is already installed');
						return;
					}
					throw new KnownError(
						`A different ${hookName} hook seems to be installed. Please remove it before installing aicommits.`
					);
				}

				await fs.mkdir(path.dirname(absoluteSymlinkPath), { recursive: true });

				if (isWindows) {
					await fs.writeFile(absoluteSymlinkPath, windowsHook);
				} else {
					await fs.symlink(hookPath, absoluteSymlinkPath, 'file');
					await fs.chmod(absoluteSymlinkPath, 0o755);
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
					const scriptContent = await fs.readFile(absoluteSymlinkPath, 'utf8');
					if (scriptContent !== windowsHook) {
						console.warn('Hook is not installed');
						return;
					}
				} else {
					const realpath = await fs.realpath(absoluteSymlinkPath);
					if (realpath !== hookPath) {
						console.warn('Hook is not installed');
						return;
					}
				}

				await fs.rm(absoluteSymlinkPath);
				console.log(`${green('✔')} Hook uninstalled`);
				return;
			}

			throw new KnownError(`Invalid mode: ${mode}`);
		})().catch((error) => {
			console.error(`${red('✖')} ${error.message}`);
			handleCliError(error);
			process.exit(1);
		});
	}
);
