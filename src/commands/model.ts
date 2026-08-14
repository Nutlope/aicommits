import { command } from 'cleye';
import { outro, log } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { selectModel } from '../feature/models.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { isInteractive } from '../utils/headless.js';

export default command(
	{
		name: 'model',
		description: 'Select or change your AI model',
		help: {
			description: 'Select or change your AI model',
		},
		alias: ['-m', 'models'],
	},
	() => {
		(async () => {
			if (!isInteractive()) {
				throw new KnownError(
					'Interactive terminal required for model selection.'
				);
			}

			const config = await getConfig();

			if (!config.provider) {
				outro('No provider configured. Run `aicommits setup` first.');
				return;
			}

			const provider = getProvider(config);
			if (!provider) {
				outro(
					'Invalid provider configured. Run `aicommits setup` to reconfigure.'
				);
				return;
			}

			const currentModel = config.OPENAI_MODEL;

			// Validate provider config
			const validation = provider.validateConfig();
			if (!validation.valid) {
				outro(
					`Configuration issues: ${validation.errors.join(
						', '
					)}. Run \`aicommits setup\` to reconfigure.`
				);
				return;
			}

			if (provider.name === 'codex' || provider.name === 'claude') {
				outro(`${provider.displayName} uses the model configured in its CLI.`);
				return;
			}

			// Select model using provider
			const selectedModel = await selectModel(
				provider.getBaseUrl(),
				provider.getApiKey() || '',
				currentModel,
				provider.getDefinition(),
				provider.displayName
			);

			if (selectedModel) {
				// Save the selected model
				await setConfigs([['OPENAI_MODEL', selectedModel]]);
				outro(`✅ Model updated to: ${selectedModel}`);
			} else {
				outro('Model selection cancelled');
			}
		})().catch(handleCommandError);
	}
);
