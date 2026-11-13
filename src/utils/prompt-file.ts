import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ValidConfig } from './config-types.js';
import { KnownError } from './error.js';

export const resolveCommitPrompt = async (
	config: Partial<Pick<ValidConfig, 'prompt-file'>>,
	cliPromptFile?: string,
	cliPrompt?: string
): Promise<string | undefined> => {
	if (cliPromptFile !== undefined && cliPrompt !== undefined) {
		throw new KnownError('Use either --prompt or --prompt-file, not both.');
	}
	if (cliPrompt !== undefined) return cliPrompt;
	const file = cliPromptFile ?? config['prompt-file'];
	if (file === undefined) return undefined;
	if (!file.trim()) throw new KnownError('Prompt file path cannot be empty.');

	const expanded = /^~[/\\]/.test(file)
		? path.join(os.homedir(), file.slice(2))
		: file;
	const filePath = path.resolve(
		cliPromptFile === undefined ? os.homedir() : process.cwd(),
		expanded
	);
	let prompt: string;
	try {
		prompt = await fs.readFile(filePath, 'utf8');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		throw new KnownError(`Cannot read prompt file "${filePath}" (${code ?? 'read failed'}).`);
	}
	if (!prompt.trim()) throw new KnownError(`Prompt file is empty: "${filePath}".`);
	return prompt;
};
