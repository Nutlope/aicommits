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
	log,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedFileChanges,
	getDetectedMessage,
} from '../utils/git.js';
import { formatStagedFile, formatStagedStatusSummary } from '../utils/staged-files.js';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { resolveCommitPrompt } from '../utils/prompt-file.js';
import { getProvider } from '../feature/providers/index.js';
import {
	formatCommitMessage,
	generateCommitMessage,
} from '../feature/generate-commit-message.js';
import { startGenerationProgress } from '../feature/generation-progress.js';
import { getCommitTypePolicy } from '../utils/config-types.js';
import {
	KnownError,
	handleCommandError,
	isModelUnavailableError,
} from '../utils/error.js';

import { getCommitMessage } from '../utils/commit-helpers.js';
import { isHeadless, isInteractive } from '../utils/headless.js';
import { offerDetectedSubscription } from '../feature/subscriptions/index.js';

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
	rawArgv: string[],
	promptFile?: string
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

		const stagedChanges = await getStagedFileChanges(excludeFiles);

		if (!stagedChanges) {
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}
		const stagedFiles = stagedChanges.map(({ path }) => path);

		if (!headless) {
			const detectingFiles = spinner();
			const detectedMessage = `${getDetectedMessage(stagedFiles)} [${formatStagedStatusSummary(stagedChanges)}]`;
			const visibleFiles = stagedChanges.slice(0, 10);
			const fileLines = visibleFiles.map((file) => `     ${formatStagedFile(file)}`);
			const remainingCount = stagedChanges.length - visibleFiles.length;
			if (remainingCount > 0) {
				fileLines.push(`     ... and ${remainingCount} more file${remainingCount > 1 ? 's' : ''}`);
			}
			detectingFiles.start('Detecting staged files');
			detectingFiles.stop(`📁 ${detectedMessage}:\n${fileLines.join('\n')}`);
		}

		let config = await getConfig({
			generate: generate?.toString(),
			type: commitType?.toString(),
		});

		let providerInstance = getProvider(config);
		if (!providerInstance && isInteractive() && config['subscription-detection']) {
			console.log(`Welcome to aicommits! Let's set up your AI provider.`);
			const chosen = await offerDetectedSubscription(config);
			if (chosen) {
				await setConfigs([['provider', chosen]]);
				config = await getConfig({
					generate: generate?.toString(),
					type: commitType?.toString(),
				});
				providerInstance = getProvider(config);
				if (providerInstance) {
					console.log(
						`${green('✔')} Using ${providerInstance.displayName}. Change it any time with \`aicommits setup\`.`
					);
				}
			}
		}
		if (!providerInstance) {
			if (!headless) {
				console.log('Run `aicommits setup` to configure your provider.');
				outro('Setup required. Please run: aicommits setup');
				return;
			} else {
				throw new KnownError(
					'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
				);
			}
		}

		const timeout = providerInstance.getRequestTimeout(config.timeout);

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
		const { requiresBody } = getCommitTypePolicy(config.type);
		const includeBody = includeDescription || requiresBody;
		const generationCount = requiresBody ? 1 : config.generate;
		const prompt = await resolveCommitPrompt(config, promptFile, customPrompt);
		const promptStrategy = config.type === 'custom'
			? 'custom'
			: prompt?.trim()
				? `built-in (${config.type}) + additional`
				: `built-in (${config.type})`;
		const promptSource = customPrompt !== undefined
			? '--prompt'
			: promptFile !== undefined
				? `--prompt-file: ${JSON.stringify(promptFile)}`
				: config['prompt-file'] !== undefined
					? `config: ${JSON.stringify(config['prompt-file'])}`
					: undefined;

		const attemptGeneration = async () => {
			const model = providerInstance.getGenerationModel(config.model!);
			if (!headless) {
				log.info(`Model: ${config.model} | Prompt: ${promptStrategy}${promptSource ? ` [${promptSource}]` : ''}`);
			}
			const progress = headless ? null : startGenerationProgress(
				spinner(),
				{
					provider: providerInstance.displayName,
					count: generationCount,
				}
			);
			let succeeded = false;
			try {
				const results = await Promise.all(
					Array.from({ length: generationCount }, async (_, index) => {
						const result = await generateCommitMessage({
							model,
							cwd: gitRoot,
							files: stagedFiles,
							type: config.type,
							locale: config.locale,
							maxLength: config['max-length'],
							includeBody,
							timeout,
							customPrompt: prompt,
							onProgress: progress
								? (event) => progress.update(index, event)
								: undefined,
						});
						progress?.complete(index, result.usage);
						return result;
					})
				);
				succeeded = true;
				return Array.from(
					new Set(results.map(({ message }) => formatCommitMessage(message)))
				);
			} finally {
				progress?.stop(succeeded);
			}
		};

		let messages: string[];
		try {
			messages = await attemptGeneration();
		} catch (error) {
			const modelUnavailable = isModelUnavailableError(error);
			const fallbackModel =
				providerInstance.getFallbackModel(config.model!) ||
				(modelUnavailable ? providerInstance.getDefaultModel() : undefined);
			if (!fallbackModel) throw error;
			if (fallbackModel === config.model) {
				throw new KnownError(
					`Model "${config.model}" is not available or has been deprecated.`
				);
			}

			if (!headless) {
				console.log(
					yellow(
						`⚠ Model "${config.model}" failed. Retrying with "${fallbackModel}".`
					)
				);
			}
			config.model = fallbackModel;
			if (modelUnavailable) {
				await setConfigs([['OPENAI_MODEL', fallbackModel]]);
			}
			messages = await attemptGeneration();
		}

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

		// Commit the message with timeout (use multiple -m for multi-line messages)
		try {
			const bodySeparator = message.indexOf('\n\n');
			const commitArgs =
				bodySeparator === -1
					? ['-m', message]
					: [
							'-m',
							message.slice(0, bodySeparator),
							'-m',
							message.slice(bodySeparator + 2),
						];
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
