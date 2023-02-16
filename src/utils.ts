import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { Configuration, OpenAIApi } from 'openai';

const fileExists = (filePath: string) => fs.access(filePath).then(() => true, () => false);

type ConfigType = {
	OPENAI_KEY?: string;
};

export const getConfig = async (): Promise<ConfigType> => {
	const configPath = path.join(os.homedir(), '.aicommits');
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return {};
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

export const generateCommitMessage = async (
	apiKey: string,
	prompt: string,
) => {
	const openai = new OpenAIApi(new Configuration({ apiKey }));
	try {
		const completion = await openai.createCompletion({
			model: 'text-davinci-003',
			prompt,
			temperature: 0.7,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
			max_tokens: 200,
			stream: false,
			n: 1,
		});

		return completion.data.choices[0].text!.trim().replace(/[\n\r]/g, '');
	} catch (error) {
		const errorAsAny = error as any;
		errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
		throw errorAsAny;
	}
};
