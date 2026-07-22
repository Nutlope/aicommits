import { execa } from 'execa';
import { black, dim, green, red, yellow, bgCyan } from 'kolorist';
import { copyToClipboard as copyMessage } from '../utils/clipboard.js';
import {
	intro,
	outro,
	spinner,
	select,
	confirm,
	isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedFiles,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { generateCommitMessage } from '../utils/generate-commit-message.js';
import { KnownError, handleCommandError } from '../utils/error.js';

import { getCommitMessage } from '../utils/commit-helpers.js';
import { isHeadless } from '../utils/headless.js';

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	skipConfirm: boolean,
	copyToClipboard: boolean,
	noVerify: boolean,
	includeDescription: boolean,
	customPrompt: string | undefined,
	rawArgv: string[]
) =>
	(async () => {
		const headless = isHeadless();

		if (!headless) {
			intro(bgCyan(black(' aicommits ')));
		}

		const gitRoot = await assertGitRepo();

		if (stageAll) {
			await execa('git', ['add', '--update']);
		}

		const stagedFiles = await getStagedFiles(excludeFiles);

		if (!stagedFiles) {
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}

		if (!headless) {
			const detectingFiles = spinner();
			if (stagedFiles.length <= 10) {
				detectingFiles.start('Detecting staged files');
				detectingFiles.stop(
					`📁 ${getDetectedMessage(stagedFiles)}:\n${stagedFiles
						.map((file) => `     ${file}`)
						.join('\n')}`
				);
			} else {
				detectingFiles.start('Detecting staged files');
				detectingFiles.stop(`📁 ${getDetectedMessage(stagedFiles)}`);
			}
		}

		const config = await getConfig({
			generate: generate?.toString(),
			type: commitType?.toString(),
		});

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			if (!headless) {
				console.log("Welcome to aicommits! Let's set up your AI provider.");
				console.log('Run `aicommits setup` to configure your provider.');
				outro('Setup required. Please run: aicommits setup');
				return;
			} else {
				throw new KnownError(
					'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
				);
			}
		}

		// Use config timeout, or default per provider
		const timeout =
			config.timeout || (providerInstance.name === 'ollama' ? 30_000 : 10_000);

		// Validate provider config
		const validation = providerInstance.validateConfig();
		if (!validation.valid) {
			throw new KnownError(
				`Provider configuration issues: ${validation.errors.join(
					', '
				)}. Run \`aicommits setup\` to reconfigure.`
			);
		}

		// Use the unified model setting or provider default
		config.model = config.OPENAI_MODEL || providerInstance.getDefaultModel();

		const model = providerInstance.getLanguageModel(config.model!);

		const attemptGeneration = async () => {
			const s = headless ? null : spinner();
			if (s) {
				s.start(
					`🔍 Analyzing changes in ${stagedFiles.length} file${
						stagedFiles.length === 1 ? '' : 's'
					}`
				);
			}
			const startTime = Date.now();
			try {
				const results = await Promise.all(
					Array.from({ length: config.generate }, () =>
						generateCommitMessage({
							model,
							cwd: gitRoot,
							files: stagedFiles,
							type: config.type,
							locale: config.locale,
							maxLength: config['max-length'],
							includeBody: includeDescription,
							timeout,
							customPrompt,
						})
					)
				);
				return Array.from(
					new Set(
						results.map(({ message }) =>
							message.body
								? `${message.subject}\n\n${message.body}`
								: message.subject
						)
					)
				);
			} finally {
				if (s) {
					const duration = Date.now() - startTime;
					s.stop(
						`✅ Changes analyzed in ${(duration / 1000).toFixed(1)}s`
					);
				}
			}
		};

		const messages = await attemptGeneration();

		if (messages.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		// Headless mode: output to stdout and exit
		if (headless) {
			const message = messages[0];
			console.log(message);
			return;
		}

		// Interactive mode: handle commit message selection and confirmation
		const message = await getCommitMessage(messages, skipConfirm);
		if (!message) {
			outro('Commit cancelled');
			return;
		}

		// Handle clipboard mode (early return)
		if (copyToClipboard) {
			const success = await copyMessage(message);
			if (success) {
				outro(`${green('✔')} Message copied to clipboard`);
			}
			return;
		}

		// Commit the message with timeout
		try {
			const commitArgs = ['-m', message];
			if (noVerify) {
				commitArgs.push('--no-verify');
			}
			await execa('git', ['commit', ...commitArgs, ...rawArgv], {
				stdio: 'inherit',
				cleanup: true,
				timeout: 10000,
			});
			outro(`${green('✔')} Successfully committed!`);
		} catch (error: any) {
			if (error.timedOut) {
				// Copy to clipboard if commit times out
				const success = await copyMessage(message);
				if (success) {
					outro(
						`${yellow(
							'⚠'
						)} Commit timed out after 10 seconds. Message copied to clipboard.`
					);
				} else {
					outro(
						`${yellow(
							'⚠'
						)} Commit timed out after 10 seconds. Could not copy to clipboard.`
					);
				}
				return;
			}

			// Handle pre-commit hook failures or other git commit errors
			if (error.exitCode !== undefined) {
				outro(
					`${red('✘')} Commit failed. This may be due to pre-commit hooks.`
				);
				console.error(
					`  ${dim('Use')} --no-verify ${dim('to bypass pre-commit hooks')}`
				);
				process.exit(1);
			}

			throw error;
		}
	})().catch(handleCommandError);
