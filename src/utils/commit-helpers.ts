import { KnownError } from './error.js';
import { isInteractive } from './headless.js';

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
	skipConfirm: boolean
): Promise<string | null> => {
	const { select, text, isCancel } = await import('@clack/prompts');
	const { dim } = await import('kolorist');

	// Single message case
	if (messages.length === 1) {
		const [message] = messages;

		if (skipConfirm) {
			return message;
		}

		if (!isInteractive()) {
			throw new KnownError('Interactive terminal required for commit message confirmation. Use --yes flag to skip confirmation.');
		}

		console.log(`\n\x1b[1m${message}\x1b[0m\n`);
		const action = await select({
			message: 'Use this commit message?',
			options: [
				{ value: 'use', label: 'Yes' },
				{ value: 'edit', label: 'Edit' },
				{ value: 'cancel', label: 'No' },
			],
		});

		if (isCancel(action) || action === 'cancel') {
			return null;
		}

		if (action === 'edit') {
			const edited = await text({
				message: 'Edit commit message:',
				initialValue: message,
				placeholder: message,
			});
			return isCancel(edited) ? null : (edited as string);
		}

		return message;
	}

	// Multiple messages case
	if (skipConfirm) {
		return messages[0];
	}

	if (!isInteractive()) {
		throw new KnownError('Interactive terminal required for commit message selection. Use --yes flag to skip selection and use the first message.');
	}

	const selected = await select({
		message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
		options: [
			...messages.map((value) => ({ label: value, value })),
			{ value: '__edit__', label: 'Edit / write my own' },
		],
	});

	if (isCancel(selected)) {
		return null;
	}

	if (selected === '__edit__') {
		const custom = await text({
			message: 'Write your commit message:',
			placeholder: 'feat: my commit message',
		});
		return isCancel(custom) ? null : (custom as string);
	}

	return selected as string;
};
