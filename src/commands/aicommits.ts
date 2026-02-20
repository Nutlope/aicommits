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

import { getCommitMessage, type CommitMessageResult } from '../utils/commit-helpers.js';

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	skipConfirm: boolean,
	copyToClipboard: boolean,
	noVerify: boolean,
	rawArgv: string[]
) =>
	(async () => {
		intro(bgCyan(black(' aicommits ')));

		await assertGitRepo();

		const detectingFiles = spinner();

		if (stageAll) {
			// This should be equivalent behavior to `git commit --all`
			await execa('git', ['add', '--update']);
		}

		detectingFiles.start('Detecting staged files');
		const staged = await getStagedDiff(excludeFiles);

		if (!staged) {
			detectingFiles.stop('Detecting staged files');
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}

		if (staged.files.length <= 10) {
			detectingFiles.stop(
				`📁 ${getDetectedMessage(staged.files)}:\n${staged.files
					.map((file) => `     ${file}`)
					.join('\n')}`
			);
		} else {
			detectingFiles.stop(`📁 ${getDetectedMessage(staged.files)}`);
		}

		const { env } = process;
		const config = await getConfig({
			generate: generate?.toString(),
			type: commitType?.toString(),
		});

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			const isInteractive = process.stdout.isTTY && !process.env.CI;
			if (isInteractive) {
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
		const isChunking = staged.files.length > MAX_FILES;

		const baseUrl = providerInstance.getBaseUrl();
		const apiKey = providerInstance.getApiKey() || '';

		// Truncate diff if too large to avoid context limits
		const maxDiffLength = 30000; // Approximate 7.5k tokens
		let diffToUse = staged.diff;
		if (diffToUse.length > maxDiffLength) {
			diffToUse =
				diffToUse.substring(diffToUse.length - maxDiffLength) +
				'\n\n[Diff truncated due to size]';
		}

		// Helper function to generate messages (supports regeneration)
		const generateMessages = async (regenerateOptions?: {
			previousMessage: string;
			userContext?: string;
		}) => {
			const s = spinner();
			const actionText = regenerateOptions ? '🔄 Regenerating' : '🔍 Analyzing';
			s.start(
				`${actionText} changes in ${staged.files.length} file${
					staged.files.length === 1 ? '' : 's'
				}`
			);
			const startTime = Date.now();
			let messages: string[];
			let usage: any;

			try {
				if (isChunking) {
					// Split files into chunks
					const chunks: string[][] = [];
					for (let i = 0; i < staged.files.length; i += CHUNK_SIZE) {
						chunks.push(staged.files.slice(i, i + CHUNK_SIZE));
					}

					const chunkMessages: string[] = [];
					let totalUsage = {
						promptTokens: 0,
						completionTokens: 0,
						totalTokens: 0,
					};

					for (const chunk of chunks) {
						const chunkDiff = await getStagedDiffForFiles(chunk, excludeFiles);
						if (chunkDiff && chunkDiff.diff) {
							let chunkDiffToUse = chunkDiff.diff;
							if (chunkDiffToUse.length > maxDiffLength) {
								chunkDiffToUse =
									chunkDiffToUse.substring(chunkDiffToUse.length - maxDiffLength) +
									'\n\n[Diff truncated due to size]';
							}
							const result = await generateCommitMessage(
								baseUrl,
								apiKey,
								config.model!,
								config.locale,
								chunkDiffToUse,
								config.generate,
								config['max-length'],
								config.type,
								timeout,
								regenerateOptions
							);
							chunkMessages.push(...result.messages);
							if (result.usage) {
								totalUsage.promptTokens +=
									(result.usage as any).promptTokens || 0;
								totalUsage.completionTokens +=
									(result.usage as any).completionTokens || 0;
								totalUsage.totalTokens += (result.usage as any).totalTokens || 0;
							}
						}
					}

					// Combine the chunk messages
					const combineResult = await combineCommitMessages(
						chunkMessages,
						baseUrl,
						apiKey,
						config.model!,
						config.locale,
						config['max-length'],
						config.type,
						timeout
					);
					messages = combineResult.messages;
					if (combineResult.usage) {
						totalUsage.promptTokens +=
							(combineResult.usage as any).promptTokens || 0;
						totalUsage.completionTokens +=
							(combineResult.usage as any).completionTokens || 0;
						totalUsage.totalTokens +=
							(combineResult.usage as any).totalTokens || 0;
					}
					usage = totalUsage;
				} else {
					const result = await generateCommitMessage(
						baseUrl,
						apiKey,
						config.model!,
						config.locale,
						diffToUse,
						config.generate,
						config['max-length'],
						config.type,
						timeout,
						regenerateOptions
					);
					messages = result.messages;
					usage = result.usage;
				}

				return { messages, usage };
			} finally {
				const duration = Date.now() - startTime;
				let tokensStr = '';
				if (usage?.total_tokens) {
					const tokens = usage.total_tokens;
					const formattedTokens =
						tokens >= 1000 ? `${(tokens / 1000).toFixed(0)}k` : tokens.toString();
					const speed = Math.round(tokens / (duration / 1000));
					tokensStr = `, ${formattedTokens} tokens (${speed} tokens/s)`;
				}
				const doneText = regenerateOptions ? '✅ Regenerated' : '✅ Changes analyzed';
				s.stop(
					`${doneText} in ${(duration / 1000).toFixed(1)}s${tokensStr}`
				);
			}
		};

		// Initial generation
		let { messages } = await generateMessages();

		if (messages.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		// Message selection loop (supports regeneration)
		let result: CommitMessageResult;
		while (true) {
			result = await getCommitMessage(messages, skipConfirm);

			if (result.action === 'cancel') {
				outro('Commit cancelled');
				return;
			}

			if (result.action === 'confirm') {
				break;
			}

			// Regenerate
			const previousMessage = messages[0]; // Use first message as reference
			const regenerated = await generateMessages({
				previousMessage,
				userContext: result.context,
			});
			messages = regenerated.messages;

			if (messages.length === 0) {
				throw new KnownError('No commit messages were generated. Try again.');
			}
		}

		const message = result.message;

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
