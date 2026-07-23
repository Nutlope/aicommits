import { dim, red } from 'kolorist';
import pkg from '../../package.json';
const { version } = pkg;

export class KnownError extends Error {}

export const isModelUnavailableError = (error: unknown) => {
	let current: unknown = error;
	const messages: string[] = [];
	for (let depth = 0; depth < 5 && current; depth += 1) {
		if (current instanceof Error) messages.push(current.message.toLowerCase());
		if (typeof current !== 'object') break;
		const errorRecord = current as Record<string, unknown>;
		if (errorRecord.status === 404 || errorRecord.statusCode === 404) return true;
		current = errorRecord.cause;
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
