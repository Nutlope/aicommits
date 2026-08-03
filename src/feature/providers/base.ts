import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTogetherAI } from '@ai-sdk/togetherai';
import type {
	JSONValue,
	LanguageModel,
	LanguageModelCallOptions,
} from 'ai';
import { fetchModels } from '../models.js';
import type { ValidConfig } from '../../utils/config-types.js';

const isLoopbackUrl = (baseUrl: string): boolean => {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
	} catch {
		return false;
	}
};

export type ProviderDef = {
	name: string;
	displayName: string;
	baseUrl: string;
	apiKeyFormat?: string;
	modelsFilter?: (models: any[]) => string[];
	defaultModels: string[];
	defaultTimeout?: number;
	requiresApiKey: boolean;
	headers?: Record<string, string>;
	cacheModels?: boolean;
	isLocal?: boolean;
	agenticGeneration?: {
		supports?: (model: string) => boolean;
		callOptions?: (model: string) => GenerationCallOptions;
	};
};

export type GenerationCallOptions = {
	maxOutputTokens?: LanguageModelCallOptions['maxOutputTokens'];
	reasoning?: LanguageModelCallOptions['reasoning'];
	providerOptions?: Record<string, Record<string, JSONValue>>;
};

export type GenerationModel = {
	languageModel: LanguageModel;
	mode: 'agentic' | 'fallback';
	isLocal: boolean;
	callOptions: GenerationCallOptions;
};

export class Provider {
	protected config: ValidConfig;
	protected def: ProviderDef;

	constructor(def: ProviderDef, config: ValidConfig) {
		this.def = def;
		this.config = config;
	}

	get name(): string {
		return this.def.name;
	}

	get displayName(): string {
		return this.def.displayName;
	}

	getDefinition(): ProviderDef {
		return this.def;
	}

	async setup(): Promise<[string, string][]> {
		const { text, password, isCancel } = await import('@clack/prompts');
		const updates: [string, string][] = [];

		if (this.def.requiresApiKey) {
			const currentKey = this.getApiKey();
			const apiKey = await password({
				message: currentKey
					? `Enter your API key (leave empty to keep current: ${currentKey.substring(
							0,
							4
					  )}****):`
					: 'Enter your API key:',
				validate: (value) => {
					if (!value && !currentKey) return 'API key is required';
					return;
				},
			});
			if (isCancel(apiKey)) {
				throw new Error('Setup cancelled');
			}
			if (apiKey) {
				updates.push(['OPENAI_API_KEY', apiKey as string]);
			}
		}

		if (this.name === 'ollama') {
			const currentEndpoint = this.getBaseUrl();
			const endpoint = await text({
				message: 'Enter Ollama endpoint (leave empty for default):',
				placeholder: currentEndpoint,
			});
			if (isCancel(endpoint)) {
				throw new Error('Setup cancelled');
			}
			if (endpoint && endpoint !== 'http://localhost:11434/v1') {
				updates.push(['OPENAI_BASE_URL', endpoint as string]);
			}
		}

		return updates;
	}

	async getModels(): Promise<{ models: string[]; error?: string }> {
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		const result = await fetchModels({
			baseUrl,
			apiKey,
			cacheModels: this.def.cacheModels,
		});
		if (result.error) return { models: [], error: result.error };

		const modelsArray = Array.isArray(result.models) ? result.models : [];
		let models: string[];
		if (this.def.modelsFilter) {
			models = this.def.modelsFilter(modelsArray);
		} else {
			// Fallback: just use model ids/names
			models = modelsArray.map((model) => model.id || model.name).filter(Boolean) as string[];
		}

		return { models };
	}

	getApiKey(): string | undefined {
		return this.def.requiresApiKey ? this.config.OPENAI_API_KEY : undefined;
	}

	getBaseUrl(): string {
		if (this.name === 'custom') {
			return this.config.OPENAI_BASE_URL || '';
		}
		return this.def.baseUrl;
	}

	getDefaultModel(): string {
		return this.def.defaultModels[0] || '';
	}

	getHighlightedModels(): string[] {
		return this.def.defaultModels;
	}

	getRequestTimeout(configuredTimeout?: number): number {
		return (
			configuredTimeout ??
			this.def.defaultTimeout ??
			(isLoopbackUrl(this.getBaseUrl()) ? 60_000 : 10_000)
		);
	}

	isLocal(): boolean {
		return this.def.isLocal ?? isLoopbackUrl(this.getBaseUrl());
	}

	getHeaders(): Record<string, string> | undefined {
		return this.def.headers;
	}

	getLanguageModel(model: string): LanguageModel {
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		const provider = (() => {
			if (this.name === 'openai') {
				return createOpenAI({ apiKey });
			}

			if (this.name === 'togetherai') {
				return createTogetherAI({ apiKey, baseURL: baseUrl });
			}

			return createOpenAICompatible({
				name: this.name,
				apiKey,
				baseURL: baseUrl,
				headers: this.getHeaders(),
			});
		})();
		return provider(model);
	}

	getGenerationModel(model: string): GenerationModel {
		return {
			languageModel: this.getLanguageModel(model),
			...this.getGenerationPolicy(model),
		};
	}

	getGenerationPolicy(
		model: string
	): Omit<GenerationModel, 'languageModel'> {
		const agenticGeneration = this.def.agenticGeneration;
		const supportsAgenticGeneration = Boolean(
			agenticGeneration && (agenticGeneration.supports?.(model) ?? true)
		);

		return {
			mode: supportsAgenticGeneration ? 'agentic' : 'fallback',
			isLocal: this.isLocal(),
			callOptions: supportsAgenticGeneration
				? agenticGeneration?.callOptions?.(model) ?? {}
				: {},
		};
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (this.def.requiresApiKey && !this.getApiKey()) {
			errors.push(`${this.displayName} API key is required`);
		}
		if (this.name === 'custom' && !this.getBaseUrl()) {
			errors.push('Custom endpoint is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
