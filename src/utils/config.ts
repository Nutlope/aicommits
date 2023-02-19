import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';

const keyValidators = {
	OPENAI_KEY(key: string) {
		if (!key) {
			return 'Cannot be empty';
		}

		if (!key.startsWith('sk-')) {
			return 'Must start with "sk-"';
		}

		if (key.length !== 51) {
			return 'Must be 51 characters long';
		}
	},
} as const;

type ValidKeys = keyof typeof keyValidators;
type ConfigType = {
	[key in ValidKeys]?: string;
};

const configPath = path.join(os.homedir(), '.aicommits');

const fileExists = (filePath: string) => fs.access(filePath).then(() => true, () => false);

export const getConfig = async (): Promise<ConfigType> => {
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return {};
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

const { hasOwnProperty } = Object.prototype;
const hasOwn = (object: unknown, key: PropertyKey) => hasOwnProperty.call(object, key);

export const setConfigs = async (
	keyValues: [key: string, value: string][],
) => {
	const config = await getConfig();

	for (const [key, value] of keyValues) {
		if (!hasOwn(keyValidators, key)) {
			throw new Error(`Invalid config property: ${key}`);
		}

		const isInvalid = keyValidators[key as ValidKeys](value);
		if (isInvalid) {
			throw new Error(`Invalid value for ${key}: ${isInvalid}`);
		}

		config[key as ValidKeys] = value;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
