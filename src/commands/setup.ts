import { command } from 'cleye';
import {
	select,
	text,
	password,
	outro,
	intro,
	isCancel,
	confirm,
	log,
	spinner,
} from '@clack/prompts';
import { bgCyan, black, dim, yellow } from 'kolorist';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider, getProviderBaseUrl } from '../feature/providers/index.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { isInteractive } from '../utils/headless.js';
import {
	buildProviderOptions,
	detectWithSpinner,
	ensureSubscription,
	type DetectionReport,
} from '../feature/subscriptions/index.js';
import { checkOpenCodeGoEntitlement } from '../feature/subscriptions/opencode.js';
import type { SubscriptionStatus } from '../feature/subscriptions/detect.js';

const emptyReport = (): DetectionReport => {
	const missing = (id: 'claude' | 'codex'): SubscriptionStatus => ({
		id,
		installed: false,
		active: false,
		binary: id,
	});
	return { statuses: { claude: missing('claude'), codex: missing('codex') } };
};

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
		help: {
			description: 'Configure your AI provider and settings',
		},
	},
	() => {
		(async () => {
			if (!isInteractive()) {
				throw new KnownError(
					'Interactive terminal required for setup. Run `aicommits setup` in a terminal.'
				);
			}

			intro(bgCyan(black(' aicommits setup ')));

			const config = await getConfig();

			const report = config['subscription-detection']
				? await detectWithSpinner(config)
				: emptyReport();

			const choice = await select({
				message: 'Choose your AI provider:',
				options: buildProviderOptions(report, config.provider),
				initialValue: config.provider,
			});
			if (isCancel(choice)) {
				outro('Setup cancelled');
				return;
			}
			const providerChoice = choice as string;

			const providerDef = getProvider({ ...config, provider: providerChoice })!.getDefinition();

			// Agent-SDK providers: make sure the vendor CLI is logged in.
			if (providerDef.kind === 'agent-sdk') {
				const ready = await ensureSubscription(providerDef, report, config);
				if (!ready) {
					outro('Setup cancelled. Log in and run `aicommits setup` again.');
					return;
				}
			}

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

			const nextConfig = { ...config, provider: providerChoice };
			nextConfig.OPENAI_BASE_URL =
				providerDef.kind === 'agent-sdk'
					? undefined
					: customBaseUrl || getProviderBaseUrl(providerChoice);
			nextConfig.OPENAI_API_KEY = undefined;
			nextConfig.OPENAI_MODEL = '';

			let provider = getProvider(nextConfig)!;

			// OpenCode Go: reuse a key the OpenCode CLI already stored, if any.
			let openCodeKeyStored = false;
			if (providerChoice === 'opencode-go') {
				const found = report.openCodeKey;
				if (found) {
					const source =
						found.source === 'env'
							? 'the OPENCODE_API_KEY environment variable'
							: 'your OpenCode CLI login';
					const useFound = await confirm({
						message: `Use the OpenCode key from ${source}? (aicommits reads it at run time and does not copy it)`,
					});
					if (isCancel(useFound)) {
						outro('Setup cancelled');
						return;
					}
					openCodeKeyStored = !useFound;
				} else {
					log.info(
						`Get an OpenCode Go key from ${dim('https://opencode.ai/auth')} (Go or Go Plus plan required).`
					);
					openCodeKeyStored = true;
				}
				if (openCodeKeyStored) {
					const apiKey = await password({
						message: 'Enter your OpenCode Go API key:',
						validate: (value) => (value ? undefined : 'API key is required'),
					});
					if (isCancel(apiKey)) {
						outro('Setup cancelled');
						return;
					}
					nextConfig.OPENAI_API_KEY = apiKey as string;
					provider = getProvider(nextConfig)!;
				}
				const s = spinner();
				s.start('Checking your OpenCode Go plan');
				const entitlement = await checkOpenCodeGoEntitlement(provider.getApiKey() || '');
				s.stop(
					entitlement === 'go'
						? 'OpenCode Go plan is active'
						: entitlement === 'zen-only'
							? yellow('This key has Zen credits but no Go plan. Go models may be rejected.')
							: entitlement === 'invalid'
								? yellow('OpenCode rejected this key.')
								: dim('Could not verify the plan right now.')
				);
				if (entitlement === 'invalid') {
					outro('Setup cancelled. Check the key and run `aicommits setup` again.');
					return;
				}
			} else if (providerDef.kind !== 'agent-sdk') {
				try {
					const apiUpdates = await provider.setup();
					for (const [k, v] of apiUpdates) {
						(nextConfig as any)[k] = v;
					}
				} catch (error) {
					if (error instanceof Error && error.message === 'Setup cancelled') {
						outro('Setup cancelled');
						return;
					}
					throw error;
				}
				provider = getProvider(nextConfig)!;
			}

			const validation = provider.validateConfig();
			if (!validation.valid) {
				outro(`Setup cancelled: ${validation.errors.join(', ')}`);
				return;
			}

			// Select model
			const { selectModel } = await import('../feature/models.js');
			const selectedModel = await selectModel(
				provider.getBaseUrl(),
				provider.getApiKey() || '',
				undefined,
				provider.getDefinition(),
				provider.displayName
			);
			if (!selectedModel) {
				outro('Model selection cancelled.');
				return;
			}
			nextConfig.OPENAI_MODEL = selectedModel;

			const typeChoice = await select({
				message: 'Choose commit message format:',
				options: [
					{ value: 'plain', label: 'Plain - Simple format without structure' },
					{ value: 'conventional', label: 'Conventional - Standard conventional commits' },
					{ value: 'conventional+body', label: 'Conventional + body - Conventional commit subject and body' },
					{ value: 'gitmoji', label: 'Gitmoji - Using emojis for commit types' },
					{ value: 'subject+body', label: 'Subject + body - Git-style subject line and body' },
				],
				initialValue: config.type || 'plain',
			});
			if (isCancel(typeChoice)) {
				outro('Setup cancelled');
				return;
			}

			await setConfigs([
				['provider', providerChoice],
				['OPENAI_BASE_URL', nextConfig.OPENAI_BASE_URL || ''],
				['OPENAI_API_KEY', nextConfig.OPENAI_API_KEY || ''],
				['OPENAI_MODEL', selectedModel],
				['type', typeChoice as string],
			]);

			outro(
				`✅ Setup complete! You're now using ${provider.displayName} with ${selectedModel}.`
			);
		})().catch(handleCommandError);
	}
);
