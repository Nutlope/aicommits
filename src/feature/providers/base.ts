import { randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
	generateText,
	type JSONValue,
	type LanguageModel,
	type LanguageModelCallOptions,
} from 'ai';
import { fetchModels } from '../models.js';
import type { ValidConfig } from '../../utils/config-types.js';
import { KnownError } from '../../utils/error.js';
import type { SubscriptionId } from '../subscriptions/detect.js';
import {
	commitMessageSchema,
	generateWithAgentSdk,
	plainTextSchema,
} from '../subscriptions/agent-sdk.js';
import {
	OPENCODE_USER_AGENT,
	resolveOpenCodeKey,
} from '../subscriptions/opencode.js';
import {
	OPENCODE_GO_MESSAGES_MODELS,
	OPENCODE_GO_RESPONSES_MODELS,
} from './opencode-go.js';

const isLoopbackUrl = (baseUrl: string): boolean => {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
	} catch {
		return false;
	}
};

export type ProviderKind = 'http' | 'agent-sdk';

export type ProviderDef = {
	name: string;
	displayName: string;
	/** `http` talks to an OpenAI-compatible endpoint through the AI SDK. `agent-sdk` drives a vendor agent SDK. */
	kind?: ProviderKind;
	/** Subscription this provider reuses, used for detection and labels. */
	subscription?: SubscriptionId | 'opencode';
	/** Short hint shown next to the provider in setup. */
	hint?: string;
	baseUrl: string;
	apiKeyFormat?: string;
	modelsPath?: string;
	modelsHeaders?: (apiKey: string) => Record<string, string>;
	modelsFilter?: (models: any[]) => string[];
	/** Fixed model list for providers without a models endpoint. */
	staticModels?: string[];
	defaultModels: string[];
	fallbackModel?: string;
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

export type AgentGenerateInput = {
	system: string;
	prompt: string;
	includeBody: boolean;
	cwd: string;
	timeout: number;
};

export type AgentGenerateOutput = {
	message: { subject: string; body?: string };
	usage?: { inputTokens?: number; outputTokens?: number };
};

export type GenerationModel = {
	/** Present for `http` providers. */
	languageModel?: LanguageModel;
	/** Present for `agent-sdk` providers: one structured call through the vendor SDK. */
	agent?: (input: AgentGenerateInput) => Promise<AgentGenerateOutput>;
	mode: 'agentic' | 'fallback';
	isLocal: boolean;
	callOptions: GenerationCallOptions;
};

export class Provider {
	protected config: ValidConfig;
	protected def: ProviderDef;
	private sessionId?: string;

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

	get kind(): ProviderKind {
		return this.def.kind ?? 'http';
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
		if (this.def.staticModels) {
			return { models: this.def.staticModels };
		}
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		const result = await fetchModels({
			baseUrl,
			apiKey,
			cacheModels: this.def.cacheModels,
			modelsPath: this.def.modelsPath,
			headers: this.getModelsHeaders(),
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

	getModelsHeaders(): Record<string, string> | undefined {
		const apiKey = this.getApiKey() || '';
		return {
			...this.getHeaders(),
			...this.def.modelsHeaders?.(apiKey),
		};
	}

	getApiKey(): string | undefined {
		if (!this.def.requiresApiKey) return undefined;
		if (this.name === 'opencode-go') {
			return this.config.OPENAI_API_KEY || resolveOpenCodeKey()?.key;
		}
		return this.config.OPENAI_API_KEY;
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

	getFallbackModel(model: string): string | undefined {
		if (!this.def.fallbackModel) return;
		if (this.def.fallbackModel !== model) {
			return this.def.fallbackModel;
		}
		return this.def.defaultModels.find((candidate) => candidate !== model);
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
		if (this.name !== 'opencode-go') return this.def.headers;
		// OpenCode Go asks clients for their own user agent and a stable
		// session id per conversation. One aicommits run is one conversation.
		this.sessionId ??= randomUUID();
		return {
			...this.def.headers,
			'User-Agent': OPENCODE_USER_AGENT,
			'x-opencode-session': this.sessionId,
			'x-opencode-client': 'aicommits',
		};
	}

	/** Path to the CLI binary an `agent-sdk` provider drives. */
	getAgentBinary(): string | undefined {
		if (this.def.subscription === 'claude') {
			return this.config['claude-path'] || 'claude';
		}
		if (this.def.subscription === 'codex') {
			return this.config['codex-path'] || 'codex';
		}
		return undefined;
	}

	getLanguageModel(model: string): LanguageModel {
		if (this.kind !== 'http') {
			throw new KnownError(
				`${this.displayName} does not expose a raw language model.`
			);
		}
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		const headers = this.getHeaders();
		const provider = (() => {
			if (this.name === 'openai') {
				return createOpenAI({ apiKey });
			}

			if (this.name === 'togetherai') {
				return createTogetherAI({ apiKey, baseURL: baseUrl });
			}

			if (this.name === 'anthropic') {
				return createAnthropic({ apiKey });
			}

			if (this.name === 'opencode-go') {
				const userAgent = headers?.['User-Agent'];
				// The AI SDK sets its own User-Agent after custom headers, so
				// restore ours on the outgoing request.
				const fetchWithUserAgent = (
					input: RequestInfo | URL,
					init?: RequestInit
				) => {
					const request = new Request(input, init);
					if (userAgent) request.headers.set('User-Agent', userAgent);
					return globalThis.fetch(request);
				};
				if (OPENCODE_GO_RESPONSES_MODELS.test(model)) {
					return createOpenAI({
						apiKey,
						baseURL: baseUrl,
						headers,
						fetch: fetchWithUserAgent,
					}).responses;
				}
				if (OPENCODE_GO_MESSAGES_MODELS.test(model)) {
					return createAnthropic({
						apiKey,
						baseURL: baseUrl,
						headers,
						fetch: fetchWithUserAgent,
					});
				}
				return createOpenAICompatible({
					name: this.name,
					apiKey,
					baseURL: baseUrl,
					headers,
					fetch: fetchWithUserAgent,
				});
			}

			return createOpenAICompatible({
				name: this.name,
				apiKey,
				baseURL: baseUrl,
				headers,
			});
		})();
		return provider(model);
	}

	getGenerationModel(model: string): GenerationModel {
		if (this.kind === 'agent-sdk') {
			return {
				agent: (input) => this.generateWithAgent(model, input),
				mode: 'fallback',
				isLocal: false,
				callOptions: {},
			};
		}
		return {
			languageModel: this.getLanguageModel(model),
			...this.getGenerationPolicy(model),
		};
	}

	private async generateWithAgent(
		model: string,
		{ system, prompt, includeBody, cwd, timeout }: AgentGenerateInput
	): Promise<AgentGenerateOutput> {
		const subscription = this.def.subscription;
		if (subscription !== 'claude' && subscription !== 'codex') {
			throw new KnownError(`${this.displayName} is not an agent provider.`);
		}
		const result = await generateWithAgentSdk(subscription, {
			prompt,
			system,
			schema: commitMessageSchema(includeBody),
			model,
			cwd,
			binary: this.getAgentBinary(),
			timeout,
		});
		const output = (result.output ?? {}) as {
			subject?: unknown;
			body?: unknown;
		};
		return {
			message: {
				subject: typeof output.subject === 'string' ? output.subject : '',
				body:
					includeBody && typeof output.body === 'string' && output.body.trim()
						? output.body.trim()
						: undefined,
			},
			usage: result.usage,
		};
	}

	/** One plain-text completion, used by `aicommits pr`. */
	async generateText({
		model,
		system,
		prompt,
		cwd,
		timeout,
	}: {
		model: string;
		system: string;
		prompt: string;
		cwd: string;
		timeout: number;
	}): Promise<string> {
		if (this.kind === 'agent-sdk') {
			const subscription = this.def.subscription as SubscriptionId;
			const result = await generateWithAgentSdk(subscription, {
				prompt,
				system,
				schema: plainTextSchema,
				model,
				cwd,
				binary: this.getAgentBinary(),
				timeout,
			});
			const output = result.output as { text?: unknown };
			return typeof output?.text === 'string' ? output.text : result.text;
		}
		const { text } = await generateText({
			model: this.getLanguageModel(model),
			system,
			prompt,
			maxRetries: 2,
			timeout,
			...this.getGenerationPolicy(model).callOptions,
		});
		return text;
	}

	getGenerationPolicy(
		model: string
	): Omit<GenerationModel, 'languageModel' | 'agent'> {
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
			errors.push(
				this.name === 'opencode-go'
					? 'OpenCode Go API key is required (set OPENCODE_API_KEY, log in with the OpenCode CLI, or run `aicommits setup`)'
					: `${this.displayName} API key is required`
			);
		}
		if (this.name === 'custom' && !this.getBaseUrl()) {
			errors.push('Custom endpoint is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
