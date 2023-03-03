import { dim } from 'kolorist';
import { version } from '../../package.json';

export class KnownError extends Error {}

export const handleCliError = (error: any) => {
	if (
		error instanceof Error
		&& !(error instanceof KnownError)
	) {
		if (error.stack) {
			console.error(dim(error.stack.split('\n').slice(1).join('\n')));
		}
		console.error(`\n    ${dim(`aicommits v${version}`)}`);
		console.error('\n    Please open a bug report with the information above:https://github.com/Nutlope/aicommits/issues/new/choose');
	}
};
