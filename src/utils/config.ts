import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';

const validKeys = ['OPENAI_KEY'] as const;

type ValidKeys = typeof validKeys[number];
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

export const setConfigs = async (
	keyValues: [key: string, value: string][],
) => {
	const config = await getConfig();

	for (const [key, value] of keyValues) {
		if (!validKeys.includes(key as any)) {
			throw new Error(`Invalid key: ${key}`);
		}

		config[key as ValidKeys] = value;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
