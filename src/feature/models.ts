// Model filtering, fetching, and selection utilities
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ProviderDef } from './providers/base.js';
import { CURRENT_LABEL_FORMAT } from '../utils/constants.js';
import { isCancel, spinner } from '@clack/prompts';
import { fileExists } from '../utils/fs.js';

interface ModelObject {
	id?: string;
	name?: string;
	type?: string;
}

interface CacheEntry {
	data: { models: ModelObject[]; error?: string };
	timestamp: number;
}

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

const getCacheDir = (): string => {
	const platform = process.platform;
	const home = os.homedir();

	if (platform === 'darwin') {
		return path.join(home, 'Library', 'Caches', 'aicommits', 'models');
	} else if (platform === 'win32') {
		return path.join(home, 'AppData', 'Local', 'aicommits', 'models');
	} else {
		// Linux/Unix
		const xdgCache = process.env.XDG_CACHE_HOME;
		const baseCache = xdgCache ? xdgCache : path.join(home, '.cache');
		return path.join(baseCache, 'aicommits', 'models');
	}
};

const getCacheKey = (baseUrl: string): string => {
	const hash = crypto.createHash('sha256');
	hash.update(baseUrl);
	return hash.digest('hex');
};

const getCachePath = (key: string): string =>
	path.join(getCacheDir(), `${key}.json`);

const readCache = async (key: string): Promise<CacheEntry | null> => {
	const cachePath = getCachePath(key);
	try {
		if (!(await fileExists(cachePath))) return null;
		const data = await fs.readFile(cachePath, 'utf8');
		return JSON.parse(data);
	} catch {
		return null;
	}
};

const writeCache = async (key: string, entry: CacheEntry): Promise<void> => {
	try {
		const cacheDir = getCacheDir();
		await fs.mkdir(cacheDir, { recursive: true });
		const cachePath = getCachePath(key);
		await fs.writeFile(cachePath, JSON.stringify(entry), 'utf8');
	} catch {
		// Ignore write errors
	}
};

interface FetchModelsOptions {
	baseUrl: string;
	apiKey?: string;
	cacheModels?: boolean;
}

// Fetch models from API
export const fetchModels = async (
	options: FetchModelsOptions,
): Promise<{ models: ModelObject[]; error?: string }> => {
	const { baseUrl, apiKey = '', cacheModels = true } = options;
	const cacheKey = getCacheKey(baseUrl);
	const now = Date.now();

	if (cacheModels) {
		const cached = await readCache(cacheKey);
		if (cached && now - cached.timestamp < CACHE_DURATION) {
			return cached.data;
		}
	}

	try {
		const response = await fetch(`${baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();

		// we do this since Together API for openai models has different response than standard needing just data, other apis data.data
		const modelsArray: ModelObject[] = (data.data ? data.data : data) || [];

		const result = { models: modelsArray };
		if (cacheModels && modelsArray.length > 0) {
			await writeCache(cacheKey, { data: result, timestamp: now });
		}
		return result;
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Request failed';
		const result = { models: [], error: errorMessage };
		return result;
	}
};

// Shared model selection function
const fetchAndFilterModels = async (
	baseUrl: string,
	apiKey: string,
	providerDef?: ProviderDef,
): Promise<string[]> => {
	// Fetch models
	const result = await fetchModels({
		baseUrl,
		apiKey,
		cacheModels: providerDef?.cacheModels,
	});

	if (result.error) {
		console.error(`Failed to fetch models: ${result.error}`);
	}

	// Apply provider-specific filtering
	let models: string[] = [];
	const modelsArray = Array.isArray(result.models) ? result.models : [];
	if (providerDef?.modelsFilter) {
		models = providerDef.modelsFilter(modelsArray);
	} else {
		// Fallback: just use model ids/names
		models = modelsArray
			.map((model) => model.id || model.name)
			.filter(Boolean) as string[];
	}
	return models;
};

const prepareModelOptions = (
	models: string[],
	currentModel?: string,
	providerDef?: ProviderDef,
) => {
	let modelOptions = models.map((model: string) => ({
		label: model,
		value: model,
	}));

	// Move highlighted models to the top
	if (providerDef?.defaultModels && providerDef.defaultModels.length > 0) {
		const highlightedModels = providerDef.defaultModels.filter((model) =>
			modelOptions.some((opt) => opt.value === model),
		);

		// Remove highlighted models from their current positions
		highlightedModels.forEach((model) => {
			const index = modelOptions.findIndex((opt) => opt.value === model);
			if (index >= 0) {
				modelOptions.splice(index, 1);
			}
		});

		// Add highlighted models at the beginning with special labels
		highlightedModels.forEach((model, index) => {
			const isCurrent = model === currentModel;
			const isDefault = index === 0;
			let label: string;
			if (isCurrent) {
				label = `✅ ${model} (current)`;
			} else if (isDefault) {
				label = `👑 ${model} (default)`;
			} else {
				label = `🔥 ${model}`;
			}
			modelOptions.unshift({ label, value: model });
		});
	}

	// Move current model to the top if it exists and isn't already highlighted
	if (currentModel && currentModel !== 'undefined') {
		const isHighlighted = providerDef?.defaultModels?.includes(currentModel);
		const currentIndex = modelOptions.findIndex(
			(opt) => opt.value === currentModel,
		);

		if (currentIndex >= 0 && !isHighlighted) {
			// Mark as current and move to top (after highlighted models)
			modelOptions[currentIndex].label = CURRENT_LABEL_FORMAT(
				modelOptions[currentIndex].value,
			);
			if (currentIndex > 0) {
				const [current] = modelOptions.splice(currentIndex, 1);
				// Find position after highlighted models
				const highlightedCount = providerDef?.defaultModels?.length || 0;
				modelOptions.splice(highlightedCount, 0, current);
			}
		} else if (currentIndex < 0 && !isHighlighted) {
			// Current model not in fetched list, add it after highlighted models
			const highlightedCount = providerDef?.defaultModels?.length || 0;
			modelOptions.splice(highlightedCount, 0, {
				label: CURRENT_LABEL_FORMAT(currentModel),
				value: currentModel,
			});
		}
	}

	return modelOptions;
};

const handleSearch = async (
	models: string[],
	select: any,
	text: any,
	isCancel: any,
): Promise<string | null> => {
	// Search for models
	const searchTerm = await text({
		message: 'Enter search term for models:',
		placeholder: 'e.g., gpt, llama',
	});
	if (isCancel(searchTerm)) {
		return null;
	}

	let filteredModels = models;
	if (searchTerm) {
		filteredModels = models.filter((model: string) =>
			model.toLowerCase().includes((searchTerm as string).toLowerCase()),
		);
	}

	// Prepare filtered options
	let searchOptions = filteredModels.slice(0, 20).map((model: string) => ({
		label: model,
		value: model,
	}));

	const searchChoice = await select({
		message: `Choose your model (filtered by "${searchTerm}"):`,
		options: [
			...searchOptions,
			{ label: 'Custom model name...', value: 'custom' },
		],
	});

	if (isCancel(searchChoice)) return null;

	return searchChoice as string;
};

const handleCustom = async (text: any): Promise<string | null> => {
	const customModel = await text({
		message: 'Enter your custom model name:',
		validate: (value: string) => {
			if (!value) return 'Model name is required';
			return;
		},
	});

	if (isCancel(customModel)) return null;

	return customModel as string;
};

export const selectModel = async (
	baseUrl: string,
	apiKey: string,
	currentModel?: string,
	providerDef?: ProviderDef,
	providerName?: string,
): Promise<string | null> => {
	// Default to provider's default model if none set
	if (!currentModel || currentModel === 'undefined') {
		currentModel = providerDef?.defaultModels?.[0];
	}

	const s = spinner();
	s.start('Fetching available models...');
	const models = await fetchAndFilterModels(baseUrl, apiKey, providerDef);
	s.stop(`${providerName || 'Provider'}: ${models.length} models available`);

	let selectedModel: string | null = null;

	if (models.length > 0) {
		const { select, text, isCancel } = await import('@clack/prompts');

		let modelOptions = prepareModelOptions(models, currentModel, providerDef);

		// Limit to max 10 models to prevent UI breaking in terminals
		const maxModels = 10;
		if (modelOptions.length > maxModels) {
			modelOptions = modelOptions.slice(0, maxModels);
		}

		let modelChoice = await select({
			message: 'Choose your model:',
			options: [
				{ label: '🔍 Search models...', value: 'search' },
				...modelOptions,
				{ label: 'Custom model name...', value: 'custom' },
			],
			initialValue: modelOptions.length > 0 ? modelOptions[0].value : undefined,
		});

		if (isCancel(modelChoice)) return null;

		if (modelChoice === 'search') {
			const searchChoice = await handleSearch(models, select, text, isCancel);
			if (searchChoice === null) return null;
			modelChoice = searchChoice;
		}

		if (modelChoice === 'custom') {
			selectedModel = await handleCustom(text);
			if (selectedModel === null) return null;
		} else {
			selectedModel = modelChoice as string;
		}
	} else {
		// Fallback to manual input
		if (providerDef?.isLocal) {
			console.log(
				`No models found on ${providerName || 'local provider'}. Please download a model first, then run \`aicommits model\` to select it.`,
			);
			return null;
		}
		console.log(
			'Could not fetch available models. Please specify a model name manually.',
		);
		const { text, isCancel } = await import('@clack/prompts');
		try {
			const model = await text({
				message: 'Enter your model name:',
				validate: (value) => {
					if (!value) return 'Model name is required';
					return;
				},
			});
			if (isCancel(model)) return null;
			selectedModel = model as string;
		} catch {
			return null;
		}
	}

	return selectedModel;
};
