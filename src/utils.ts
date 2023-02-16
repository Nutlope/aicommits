import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { execa } from 'execa';
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

export const assertGitRepo = async () => {
	const { stdout } = await execa('git', ['rev-parse', '--is-inside-work-tree'], { reject: false });

	if (stdout !== 'true') {
		throw new Error('The current directory must be a Git repository!');
	}
};

const excludeFromDiff = [
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
].map(file => `:(exclude)${file}`);

export const getStagedDiff = async () => {
	const diffCached = ['diff', '--cached'];
	const { stdout: files } = await execa(
		'git',
		[...diffCached, '--name-only', ...excludeFromDiff],
	);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa(
		'git',
		[...diffCached, ...excludeFromDiff],
	);

	return {
		files: files.split('\n'),
		diff,
	};
};

export const getDetectedMessage = (files: string[]) => `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? 's' : ''}`;

const promptTemplate = 'Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything:';

export const generateCommitMessage = async (
	apiKey: string,
	diff: string,
) => {
	const prompt = `${promptTemplate}\n${diff}`;

	// Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
	if (prompt.length > 8000) {
		throw new Error('The diff is too large for the OpenAI API');
	}

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

		return completion.data.choices[0].text!.trim().replace(/[\n\r]/g, '').replace(/\.$/, "");
	} catch (error) {
		const errorAsAny = error as any;
		errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
		throw errorAsAny;
	}
};
