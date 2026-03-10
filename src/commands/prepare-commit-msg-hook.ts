import fs from 'fs/promises';
import { intro, outro, spinner } from '@clack/prompts';
import { black, green, red, bgCyan } from 'kolorist';
import { getStagedDiff } from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { generateCommitMessage } from '../utils/openai.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { isHeadless } from '../utils/headless.js';

const [messageFilePath, commitSource] = process.argv.slice(2);

export default () =>
	(async () => {
		if (!messageFilePath) {
			throw new KnownError(
				'Commit message file path is missing. This file should be called from the "prepare-commit-msg" git hook'
			);
		}

		// If a commit message is passed in, ignore
		if (commitSource) {
			return;
		}

		// All staged files can be ignored by our filter
		const staged = await getStagedDiff();
		if (!staged) {
			return;
		}

		const headless = isHeadless();
		if (!headless) {
			intro(bgCyan(black(' aicommits ')));
		}

		const config = await getConfig({});

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			throw new KnownError(
				'Invalid provider configuration. Run `aicommits setup` to reconfigure.'
			);
		}

		// Validate provider config
		const validation = providerInstance.validateConfig();
		if (!validation.valid) {
			throw new KnownError(
				`Provider configuration issues: ${validation.errors.join(
					', '
				)}. Run \`aicommits setup\` to reconfigure.`
			);
		}

		const baseUrl = providerInstance.getBaseUrl();
		const apiKey = providerInstance.getApiKey() || '';
		const providerHeaders = providerInstance.getHeaders();

		// Use config timeout, or default per provider
		const timeout =
			config.timeout || (providerInstance.name === 'ollama' ? 30_000 : 10_000);

		// Use the unified model or provider default
		let model = config.OPENAI_MODEL || providerInstance.getDefaultModel();

		const s = headless ? null : spinner();
		s?.start('The AI is analyzing your changes');
		let messages: string[];
		try {
			const result = await generateCommitMessage({
				baseUrl,
				apiKey,
				model,
				locale: config.locale,
				diff: staged!.diff,
				completions: config.generate,
				maxLength: config['max-length'],
				type: config.type,
				timeout,
				headers: providerHeaders,
			});
			messages = result.messages;
		} finally {
			s?.stop('Changes analyzed');
		}

		/**
		 * When `--no-edit` is passed in, the base commit message is empty,
		 * and even when you use pass in comments via #, they are ignored.
		 *
		 * Note: `--no-edit` cannot be detected in argvs so this is the only way to check
		 */
		const baseMessage = await fs.readFile(messageFilePath, 'utf8');
		const supportsComments = baseMessage !== '';
		const hasMultipleMessages = messages.length > 1;

		let instructions = '';

		if (supportsComments) {
			instructions = `# 🤖 AI generated commit${
				hasMultipleMessages ? 's' : ''
			}\n`;
		}

		if (hasMultipleMessages) {
			if (supportsComments) {
				instructions +=
					'# Select one of the following messages by uncommenting:\n';
			}
			instructions += `\n${messages
				.map((message) => `# ${message}`)
				.join('\n')}`;
		} else {
			if (supportsComments) {
				instructions += '# Edit the message below and commit:\n';
			}
			instructions += `\n${messages[0]}\n`;
		}

		const currentContent = await fs.readFile(messageFilePath, 'utf8');
		const newContent = instructions + '\n' + currentContent;
		await fs.writeFile(messageFilePath, newContent);

		if (!headless) {
			outro(`${green('✔')} Saved commit message!`);
		}
	})().catch(handleCommandError);
