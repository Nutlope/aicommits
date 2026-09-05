import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';
import {
	configParsers,
	hasOwn,
	type ValidConfig,
	type ConfigKeys,
	type RawConfig,
} from './config-types.js';
import { providers } from '../feature/providers/providers-data.js';

const getDefaultBaseUrl = (): string => {
	const openaiProvider = providers.find((p) => p.name === 'openai');
	return openaiProvider?.baseUrl || '';
};

const detectProvider = (
	baseUrl?: string,
	apiKey?: string
): string | undefined => {
	if (baseUrl) {
		const matchingProvider = providers.find(
			(p) =>
				p.baseUrl === baseUrl ||
				(p.name === 'ollama' && baseUrl.startsWith(p.baseUrl.slice(0, -3)))
		);
		if (matchingProvider) {
			return matchingProvider.name;
		} else {
			return 'custom';
		}
	} else if (apiKey) {
		return 'openai';
	}
};

const getConfigPath = () => path.join(os.homedir(), '.aicommits');

const parseConfigValue = (key: ConfigKeys, value: unknown) => {
	if (key === 'PROVIDER_OPTIONS') {
		return configParsers.PROVIDER_OPTIONS(value);
	}

	return configParsers[key](value as string | undefined);
};

const readConfigFile = async (): Promise<RawConfig> => {
	const configExists = await fileExists(getConfigPath());
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(getConfigPath(), 'utf8');
	return ini.parse(configString);
};

export const getConfig = async (
	cliConfig?: RawConfig,
	envConfig?: RawConfig,
	suppressErrors?: boolean
): Promise<ValidConfig> => {
	const config = await readConfigFile();

	// Check for deprecated config properties
	if (hasOwn(config, 'proxy')) {
		console.warn('The "proxy" config property is deprecated and no longer supported');
	}

	const parsedConfig: Record<string, unknown> = {};
	const effectiveEnvConfig = envConfig ?? {};

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const value = cliConfig?.[key] ?? effectiveEnvConfig?.[key] ?? config[key];

		if (suppressErrors) {
			try {
				parsedConfig[key] = parseConfigValue(key, value);
			} catch {}
		} else {
			parsedConfig[key] = parseConfigValue(key, value);
		}
	}

	// Detect provider from OPENAI_BASE_URL or default to OpenAI if only API key is set
	let provider: string | undefined;
	let baseUrl = parsedConfig.OPENAI_BASE_URL as string | undefined;
	const apiKey = parsedConfig.OPENAI_API_KEY as string | undefined;

	// If only API key is provided without base URL, default to OpenAI
	if (!baseUrl && apiKey) {
		baseUrl = getDefaultBaseUrl();
		parsedConfig.OPENAI_BASE_URL = baseUrl;
	}

	provider = detectProvider(baseUrl, apiKey);

	return { ...parsedConfig, model: parsedConfig.OPENAI_MODEL, provider } as ValidConfig;
};

export const setConfigs = async (keyValues: [key: string, value: string][]) => {
	const config = await readConfigFile();

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		if (value === '') {
			delete config[key as ConfigKeys];
		} else {
			const parsed = configParsers[key as ConfigKeys](value);
			config[key as ConfigKeys] = parsed as any;
		}
	}

	await fs.writeFile(getConfigPath(), ini.stringify(config), 'utf8');
};
