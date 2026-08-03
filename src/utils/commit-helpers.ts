import { KnownError } from './error.js';
import { isInteractive } from './headless.js';

type CommitPromptDependencies = {
	isInteractive: () => boolean;
	isCancel: (value: unknown) => boolean;
	select: (options: {
		message: string;
		options: { label: string; value: string }[];
	}) => Promise<unknown>;
	text: (options: {
		message: string;
		initialValue: string;
		validate: (value: string | undefined) => string | undefined;
	}) => Promise<unknown>;
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const retry = async <T>(fn: () => Promise<T>, attempts: number = 3, delay: number = 1000): Promise<T> => {
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i === attempts - 1) throw error;
			await sleep(delay);
		}
	}
	throw new Error('Retry failed');
};

export const getCommitMessage = async (
	messages: string[],
	skipConfirm: boolean,
	dependencies?: CommitPromptDependencies
): Promise<string | null> => {
	if (skipConfirm) {
		return messages[0];
	}

	const prompts = dependencies ?? await (async () => {
		const clack = await import('@clack/prompts');
		return {
			isInteractive,
			isCancel: (value: unknown) => clack.isCancel(value),
			select: (options: Parameters<typeof clack.select>[0]) =>
				clack.select(options),
			text: (options: Parameters<typeof clack.text>[0]) =>
				clack.text(options),
		};
	})();
	const { select, text, isCancel } = prompts;

	if (!prompts.isInteractive()) {
		throw new KnownError(
			messages.length === 1
				? 'Interactive terminal required for commit message confirmation. Use --yes flag to skip confirmation.'
				: 'Interactive terminal required for commit message selection. Use --yes flag to skip selection and use the first message.'
		);
	}

	let message = messages[0];
	if (messages.length > 1) {
		const selected = await select({
			message: 'Pick a commit message to use: (Ctrl+c to exit)',
			options: messages.map((value) => ({ label: value, value })),
		});
		if (isCancel(selected)) {
			return null;
		}
		message = selected as string;
	}

	console.log(`\n\x1b[1m${message}\x1b[0m\n`);
	const action = await select({
		message: 'Use this commit message?',
		options: [
			{ label: 'Yes', value: 'accept' },
			{ label: 'No', value: 'cancel' },
			{ label: 'Edit', value: 'edit' },
		],
	});
	if (isCancel(action) || action === 'cancel') {
		return null;
	}
	if (action === 'accept') {
		return message;
	}

	const separatorIndex = message.indexOf('\n\n');
	const subject =
		separatorIndex === -1 ? message : message.slice(0, separatorIndex);
	const body =
		separatorIndex === -1 ? '' : message.slice(separatorIndex + 2);
	const editedSubject = await text({
		message: 'Edit commit message subject:',
		initialValue: subject,
		validate: (value) =>
			value?.trim() ? undefined : 'Commit message subject cannot be empty.',
	});
	if (isCancel(editedSubject)) {
		return null;
	}

	const trimmedSubject = (editedSubject as string).trim();
	return body ? `${trimmedSubject}\n\n${body}` : trimmedSubject;
};
