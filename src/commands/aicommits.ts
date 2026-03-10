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
	getStagedDiff,
	getStagedDiffForFiles,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import {
	generateCommitMessage,
	combineCommitMessages,
} from '../utils/openai.js';
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
	customPrompt: string | undefined,
	rawArgv: string[]
) =>
	(async () => {
		const headless = isHeadless();
		
		if (!headless) {
			intro(bgCyan(black(' aicommits ')));
		}

		await assertGitRepo();

		if (stageAll) {
			await execa('git', ['add', '--update']);
		}

		const staged = await getStagedDiff(excludeFiles);

		if (!staged) {
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}

		if (!headless) {
			const detectingFiles = spinner();
			if (staged.files.length <= 10) {
				detectingFiles.start('Detecting staged files');
				detectingFiles.stop(
					`📁 ${getDetectedMessage(staged.files)}:\n${staged.files
						.map((file) => `     ${file}`)
						.join('\n')}`
				);
			} else {
				detectingFiles.start('Detecting staged files');
				detectingFiles.stop(`📁 ${getDetectedMessage(staged.files)}`);
			}
		}

		const { env } = process;
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

		// Check if diff is large and needs chunking
		const MAX_FILES = 50;
		const CHUNK_SIZE = 10;
		let isChunking = false;
		if (staged.files.length > MAX_FILES) {
			isChunking = true;
		}

		const s = headless ? null : spinner();
		if (s) {
			s.start(
				`🔍 Analyzing changes in ${staged.files.length} file${
					staged.files.length === 1 ? '' : 's'
				}`
			);
		}
		const startTime = Date.now();
		let messages: string[];
		let usage: any;
		try {
			const baseUrl = providerInstance.getBaseUrl();
			const apiKey = providerInstance.getApiKey() || '';
			const providerHeaders = providerInstance.getHeaders();

			if (isChunking) {
				// Split files into chunks
				const chunks: string[][] = [];
				for (let i = 0; i < staged.files.length; i += CHUNK_SIZE) {
					chunks.push(staged.files.slice(i, i + CHUNK_SIZE));
				}

				const chunkMessages: string[] = [];
				let totalUsage = {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				};

				for (const chunk of chunks) {
					const chunkDiff = await getStagedDiffForFiles(chunk, excludeFiles);
					if (chunkDiff && chunkDiff.diff) {
						// Truncate diff if too large to avoid context limits
						const maxDiffLength = 30000; // Approximate 7.5k tokens
						let diffToUse = chunkDiff.diff;
						if (diffToUse.length > maxDiffLength) {
							diffToUse =
								diffToUse.substring(0, maxDiffLength) +
								'\n\n[Diff truncated due to size]';
						}
						const result = await generateCommitMessage({
							baseUrl,
							apiKey,
							model: config.model!,
							locale: config.locale,
							diff: diffToUse,
							completions: config.generate,
							maxLength: config['max-length'],
							type: config.type,
							timeout,
							customPrompt,
							headers: providerHeaders,
						});
						chunkMessages.push(...result.messages);
						if (result.usage) {
							totalUsage.prompt_tokens +=
								(result.usage as any).prompt_tokens ||
								(result.usage as any).promptTokens ||
								0;
							totalUsage.completion_tokens +=
								(result.usage as any).completion_tokens ||
								(result.usage as any).completionTokens ||
								0;
							totalUsage.total_tokens +=
								(result.usage as any).total_tokens ||
								(result.usage as any).totalTokens ||
								0;
						}
					}
				}

				// Combine the chunk messages
				const combineResult = await combineCommitMessages({
					messages: chunkMessages,
					baseUrl,
					apiKey,
					model: config.model!,
					locale: config.locale,
					maxLength: config['max-length'],
					type: config.type,
					timeout,
					customPrompt,
					headers: providerHeaders,
				});
				messages = combineResult.messages;
				if (combineResult.usage) {
					totalUsage.prompt_tokens +=
						(combineResult.usage as any).prompt_tokens ||
						(combineResult.usage as any).promptTokens ||
						0;
					totalUsage.completion_tokens +=
						(combineResult.usage as any).completion_tokens ||
						(combineResult.usage as any).completionTokens ||
						0;
					totalUsage.total_tokens +=
						(combineResult.usage as any).total_tokens ||
						(combineResult.usage as any).totalTokens ||
						0;
				}
				usage = totalUsage;
			} else {
				// Truncate diff if too large to avoid context limits
				const maxDiffLength = 30000; // Approximate 7.5k tokens
				let diffToUse = staged.diff;
				if (diffToUse.length > maxDiffLength) {
					diffToUse =
						diffToUse.substring(0, maxDiffLength) +
						'\n\n[Diff truncated due to size]';
				}
				const result = await generateCommitMessage({
					baseUrl,
					apiKey,
					model: config.model!,
					locale: config.locale,
					diff: diffToUse,
					completions: config.generate,
					maxLength: config['max-length'],
					type: config.type,
					timeout,
					customPrompt,
					headers: providerHeaders,
				});
				messages = result.messages;
				usage = result.usage;
			}
		} finally {
			if (s) {
				const duration = Date.now() - startTime;
				let tokensStr = '';
				if (usage?.total_tokens) {
					const tokens = usage.total_tokens;
					const formattedTokens =
						tokens >= 1000 ? `${(tokens / 1000).toFixed(0)}k` : tokens.toString();
					const speed = Math.round(tokens / (duration / 1000));
					tokensStr = `, ${formattedTokens} tokens (${speed} tokens/s)`;
				}
				s.stop(
					`✅ Changes analyzed in ${(duration / 1000).toFixed(1)}s${tokensStr}`
				);
			}
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

		// Commit the message with timeout
			try {
				const commitArgs = ['-m', message];
				if (noVerify) {
					commitArgs.push('--no-verify');
				}
				await execa('git', ['commit', ...commitArgs, ...rawArgv], {
					stdio: 'inherit',
					cleanup: true,
					timeout: 10000
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
			throw error;
		}
	})().catch(handleCommandError);
