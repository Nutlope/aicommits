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

const promptTemplate = `I want you to act like a git commit message writer. I will input a git diff and your job is to convert it into a useful commit message. Do not preface the commit with anything, use the present tense, return a complete sentence, and do not repeat yourself:`;

export const generateCommitMessage = async (
	apiKey: string,
	diff: string,
) => {
	const prompt = `${promptTemplate}\n${diff};`

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

		return completion.data.choices[0].text!.trim().replace(/[\n\r]/g, '');
	} catch (error) {
		const errorAsAny = error as any;
		errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
		throw errorAsAny;
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
