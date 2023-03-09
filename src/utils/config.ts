import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';

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
	OPENAI_KEY(key: string) {
		parseAssert('OPENAI_KEY', key, 'Cannot be empty');
		parseAssert('OPENAI_KEY', key.startsWith('sk-'), 'Must start with "sk-"');
		parseAssert('OPENAI_KEY', key.length === 51, 'Must be 51 characters long');

		return key;
	},
	locale(key: string) {
		parseAssert('locale', key, 'Cannot be empty');
		parseAssert('locale', /^[a-z-]+$/i.test(key), 'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes');

		return key;
	},
	generate(key: string) {
		parseAssert('generate', key, 'Cannot be empty');
		parseAssert('generate', /^\d+$/.test(key), 'Must be an integer');

		const parsed = Number(key);
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');

		return parsed;
	},
} as const;

type ValidKeys = keyof typeof configParsers;
type ConfigType = {
	[key in ValidKeys]?: ReturnType<typeof configParsers[key]>;
};

const configPath = path.join(os.homedir(), '.aicommits');

export const getConfig = async (): Promise<ConfigType> => {
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return {};
	}

	const configString = await fs.readFile(configPath, 'utf8');
	const config = ini.parse(configString);
	for (const key of Object.keys(config)) {
		const parsed = configParsers[key as ValidKeys](config[key]);
		config[key as ValidKeys] = parsed;
	}

	return config;
};

const { hasOwnProperty } = Object.prototype;
const hasOwn = (object: unknown, key: PropertyKey) => hasOwnProperty.call(object, key);

export const setConfigs = async (
	keyValues: [key: string, value: string][],
) => {
	const config = await getConfig();

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const parsed = configParsers[key as ValidKeys](value);
		config[key as ValidKeys] = parsed as any;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
