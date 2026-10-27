import {
	formatCommitMessage,
	generateCommitMessage,
} from './generate-commit-message.js';
import { getProvider } from './providers/index.js';
import type { ValidConfig } from '../utils/config-types.js';
import { getCommitTypePolicy } from '../utils/config-types.js';
import { setConfigs } from '../utils/config-runtime.js';
import {
	isModelUnavailableError,
	KnownError,
} from '../utils/error.js';

export type GenerationSpinner = {
	start(message: string): void;
	stop(message: string): void;
};

export type GenerateCommitMessagesOptions = {
	config: ValidConfig;
	gitRoot: string;
	files: string[];
	includeDescription?: boolean;
	customPrompt?: string;
	spinner?: GenerationSpinner | null;
	onModelFallback?: (previousModel: string, fallbackModel: string) => void;
};

// Shared orchestration for the CLI command and the MCP server. Must never
// write to stdout — the MCP server speaks its protocol over it.
export const generateCommitMessages = async ({
	config,
	gitRoot,
	files,
	includeDescription,
	customPrompt,
	spinner,
	onModelFallback,
}: GenerateCommitMessagesOptions): Promise<string[]> => {
	const providerInstance = getProvider(config);
	if (!providerInstance) {
		throw new KnownError(
			'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
		);
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

	const attemptGeneration = async () => {
		const model = providerInstance.getGenerationModel(config.model!);
		if (spinner) {
			spinner.start(
				`🔍 Analyzing changes in ${files.length} file${
					files.length === 1 ? '' : 's'
				}`
			);
		}
		const startTime = Date.now();
		try {
			const results = await Promise.all(
				Array.from({ length: generationCount }, () =>
					generateCommitMessage({
						model,
						cwd: gitRoot,
						files,
						type: config.type,
						locale: config.locale,
						maxLength: config['max-length'],
						includeBody,
						timeout,
						customPrompt,
					})
				)
			);
			return Array.from(
				new Set(results.map(({ message }) => formatCommitMessage(message)))
			);
		} finally {
			if (spinner) {
				const duration = Date.now() - startTime;
				spinner.stop(
					`✅ Changes analyzed in ${(duration / 1000).toFixed(1)}s`
				);
			}
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

		onModelFallback?.(config.model, fallbackModel);
		config.model = fallbackModel;
		if (modelUnavailable) {
			await setConfigs([['OPENAI_MODEL', fallbackModel]]);
		}
		messages = await attemptGeneration();
	}

	if (messages.length === 0) {
		throw new KnownError('No commit messages were generated. Try again.');
	}

	return messages;
};