import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) => hasOwnProperty.call(object, key);

const parseAssert = (
	name: string,
	condition: any,
	message: string,
) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

const configParsers = {
	OPENAI_KEY(key?: string) {
		if (!key) {
			throw new KnownError('Please set your OpenAI API key via `aicommits config set OPENAI_KEY=<your token>`');
		}
		parseAssert('OPENAI_KEY', key.startsWith('sk-'), 'Must start with "sk-"');
		// Key can range from 43~51 characters. There's no spec to assert this.

		return key;
	},
	locale(locale?: string) {
		if (!locale) {
			return 'en';
		}

		parseAssert('locale', locale, 'Cannot be empty');
		parseAssert('locale', /^[a-z-]+$/i.test(locale), 'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes');

		return locale;
	},
	generate(count?: string) {
		if (!count) {
			return 1;
		}

		parseAssert('generate', /^\d+$/.test(count), 'Must be an integer');

		const parsed = Number(count);
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');

		return parsed;
	},
} as const;

type ConfigKeys = keyof typeof configParsers;

type RawConfig = {
	[key in ConfigKeys]?: string;
};

type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<typeof configParsers[Key]>;
};

const configPath = path.join(os.homedir(), '.aicommits');

const readConfigFile = async (): Promise<RawConfig> => {
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

export const getConfig = async (cliConfig?: RawConfig): Promise<ValidConfig> => {
	const config = await readConfigFile();
	const parsedConfig: Record<string, unknown> = {};

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const parser = configParsers[key];
		const value = cliConfig?.[key] ?? config[key];
		parsedConfig[key] = parser(value);
	}

	return parsedConfig as ValidConfig;
};

export const setConfigs = async (
	keyValues: [key: string, value: string][],
) => {
	const config = await readConfigFile();

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const parsed = configParsers[key as ConfigKeys](value);
		config[key as ConfigKeys] = parsed as any;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
