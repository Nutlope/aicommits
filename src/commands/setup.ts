import { execSync } from 'child_process';
import { command } from 'cleye';
import { select, text, outro, isCancel, confirm } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import {
	getProvider,
	getAvailableProviders,
	getProviderBaseUrl,
} from '../feature/providers/index.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { isInteractive } from '../utils/headless.js';

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
		help: {
			description: 'Configure your AI provider and settings',
		},
	},
	(argv) => {
		(async () => {
			if (!isInteractive()) {
				throw new KnownError(
					'Interactive terminal required for setup. Run `aicommits setup` in a terminal.'
				);
			}

			let config = await getConfig();

			const providerOptions = getAvailableProviders();
			const choice = await select({
				message: 'Choose your AI provider:',
				options: providerOptions,
				initialValue: config.provider,
			});

			if (isCancel(choice)) {
				outro('Setup cancelled');
				return;
			}
			const providerChoice = choice as string;

			// Ask for custom base URL if custom provider
			let customBaseUrl = '';
			if (providerChoice === 'custom') {
				const baseUrlInput = await text({
					message: 'Enter your custom API endpoint:',
					validate: (value: string) => {
						if (!value) return 'Endpoint is required';
						try {
							new URL(value);
						} catch {
							return 'Invalid URL format';
						}
						return;
					},
				});
				if (isCancel(baseUrlInput)) {
					outro('Setup cancelled');
					return;
				}
				customBaseUrl = baseUrlInput as string;
			}

			// Set default base URL for the provider
			let defaultBaseUrl = customBaseUrl || getProviderBaseUrl(providerChoice);

			// Set defaults
			config.OPENAI_BASE_URL = defaultBaseUrl;
			config.OPENAI_API_KEY = '';
			config.OPENAI_MODEL = '';

			// Get provider instance
			let provider = getProvider({ ...config, provider: providerChoice });
			if (!provider) {
				outro('Invalid provider selected');
				return;
			}

			try {
				const apiUpdates = await provider.setup();
				for (const [k, v] of apiUpdates) {
					(config as any)[k] = v;
				}
			} catch (error) {
				if (error instanceof Error && error.message === 'Setup cancelled') {
					outro('Setup cancelled');
					return;
				}
				throw error;
			}

			// Recreate provider with updated config for validation
			provider = getProvider({ ...config, provider: providerChoice });
			if (!provider) {
				outro('Invalid provider selected');
				return;
			}

			// Validate configuration
			const validation = provider.validateConfig();
			if (!validation.valid) {
				outro(`Setup cancelled: ${validation.errors.join(', ')}`);
				return;
			}

			// Select model interactively
			const { selectModel } = await import('../feature/models.js');
			const selectedModel = await selectModel(
				provider.getBaseUrl(),
				provider.getApiKey() || '',
				undefined,
				provider.getDefinition()
			);

			if (selectedModel) {
				config.OPENAI_MODEL = selectedModel;
				console.log(`Model selected: ${selectedModel}`);
			} else {
				outro('Model selection cancelled.');
				return;
			}

			const typeChoice = await select({
				message: 'Choose commit message format:',
				options: [
					{ value: 'plain', label: 'Plain - Simple format without structure' },
					{ value: 'conventional', label: 'Conventional - Standard conventional commits' },
					{ value: 'gitmoji', label: 'Gitmoji - Using emojis for commit types' },
					{ value: 'subject+body', label: 'Subject + body - Git-style subject line and body' },
				],
				initialValue: 'plain',
			});

			if (isCancel(typeChoice)) {
				outro('Setup cancelled');
				return;
			}
			(config as any).type = typeChoice as string;

			// Save all config at once
			const finalUpdates = Object.entries(config).filter(
				([k, v]) =>
					k !== 'provider' &&
					k !== 'model' &&
					v !== undefined &&
					v !== '' &&
					typeof v === 'string'
			) as [string, string][];
			await setConfigs(finalUpdates);

			outro(`✅ Setup complete! You're now using ${provider.displayName}.`);

			// // Offer to create git alias
			// const aliasChoice = await confirm({
			// 	message: 'Would you like to create a git alias "git ac" for "aicommits"?',
			// });

			// if (aliasChoice) {
			// 	try {
			// 		execSync('git config --global alias.ac "!aicommits"', { stdio: 'inherit' });
			// 		console.log('✅ Git alias "git ac" created successfully.');
			// 	} catch (error) {
			// 		console.error(`❌ Failed to create git alias: ${(error as Error).message}`);
			// 	}
			// }
		})().catch(handleCommandError);
	}
);
