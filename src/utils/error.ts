import { dim, red } from 'kolorist';
import pkg from '../../package.json';
const { version } = pkg;

export class KnownError extends Error {}

const getErrorChain = (error: unknown) => {
	const chain: unknown[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		chain.push(current);
		if (typeof current !== 'object') break;
		current = (current as Record<string, unknown>).cause;
	}
	return chain;
};

export const isModelUnavailableError = (error: unknown) => {
	const messages: string[] = [];
	for (const current of getErrorChain(error)) {
		if (current instanceof Error) messages.push(current.message.toLowerCase());
		if (typeof current !== 'object') continue;
		const errorRecord = current as Record<string, unknown>;
		if (errorRecord.status === 404 || errorRecord.statusCode === 404) return true;
	}

	const message = messages.join(' ');
	return (
		message.includes('unable to access') ||
		(message.includes('model') &&
			(message.includes('not found') ||
				message.includes('does not exist') ||
				message.includes('deprecated') ||
				message.includes('unavailable')))
	);
};

export const isToolUnsupportedError = (error: unknown) => {
	const messages: string[] = [];
	for (const current of getErrorChain(error)) {
		if (current instanceof Error) messages.push(current.message.toLowerCase());
		if (typeof current !== 'object') continue;
		const errorRecord = current as Record<string, unknown>;
		for (const key of ['responseBody', 'data']) {
			const value = errorRecord[key];
			if (typeof value === 'string') messages.push(value.toLowerCase());
		}
	}

	const message = messages.join(' ');
	const namesToolParameter =
		message.includes("'tools'") ||
		message.includes('"tools"') ||
		message.includes('tool_choice') ||
		message.includes('tool choice');
	const rejectsToolCalling =
		message.includes('does not support tools') ||
		message.includes("doesn't support tools") ||
		message.includes('tools are not supported') ||
		message.includes('tool calling is not supported') ||
		message.includes('does not support tool calling') ||
		message.includes('function calling is not supported') ||
		message.includes('does not support function calling');
	const rejectsToolParameter =
		namesToolParameter &&
		(message.includes('unsupported parameter') ||
			message.includes('invalid parameter') ||
			message.includes('unknown parameter') ||
			message.includes('not supported'));

	return rejectsToolCalling || rejectsToolParameter;
};

export const isInvalidJsonResponseError = (error: unknown) => {
	for (const current of getErrorChain(error)) {
		if (
			current instanceof Error &&
			current.message.toLowerCase().includes('invalid json response')
		) {
			return true;
		}
	}
	return false;
};

const indent = '    ';

export const handleCliError = (error: unknown) => {
	if (error instanceof Error && !(error instanceof KnownError)) {
		if (error.stack) {
			console.error(dim(error.stack.split('\n').slice(1).join('\n')));
		}
		console.error(`\n${indent}${dim(`aicommits v${version}`)}`);
		console.error(
			`\n${indent}Please open a Bug report with the information above:`
		);
		console.error(
			`${indent}https://github.com/Nutlope/aicommits/issues/new/choose`
		);
	}
};

export const handleCommandError = (error: unknown) => {
	process.stderr.write(`${red('✖')} ${(error as Error).message}\n`);
	handleCliError(error);
	process.exit(1);
};
