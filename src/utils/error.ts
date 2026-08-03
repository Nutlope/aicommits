import { dim, red } from 'kolorist';
import pkg from '../../package.json';
const { version } = pkg;

export class KnownError extends Error {}

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
