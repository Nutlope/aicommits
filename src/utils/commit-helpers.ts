import { KnownError } from './error.js';

export type CommitMessageResult =
	| { action: 'confirm'; message: string }
	| { action: 'cancel' }
	| { action: 'regenerate'; context?: string };

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
): Promise<CommitMessageResult> => {
	const { select, text, isCancel } = await import('@clack/prompts');
	const { dim } = await import('kolorist');

	// Check if interactive prompts are available
	const isInteractive = process.stdout.isTTY && !process.env.CI;

	// Single message case
	if (messages.length === 1) {
		const [message] = messages;

		if (skipConfirm) {
			return { action: 'confirm', message };
		}

		if (!isInteractive) {
			throw new KnownError('Interactive terminal required for commit message confirmation. Use --confirm flag to skip confirmation.');
		}

		console.log(`\n\x1b[1m${message}\x1b[0m\n`);
		const selected = await select({
			message: 'What would you like to do?',
			options: [
				{ label: 'Use this commit message', value: 'confirm' },
				{ label: `Regenerate ${dim('(r)')}`, value: 'regenerate' },
				{ label: 'Cancel', value: 'cancel' },
			],
		});

		if (isCancel(selected) || selected === 'cancel') {
			return { action: 'cancel' };
		}

		if (selected === 'regenerate') {
			const context = await text({
				message: `Add context for regeneration ${dim('(optional, press Enter to skip)')}:`,
				placeholder: 'e.g., "focus on the bug fix" or "be more specific"',
			});

			if (isCancel(context)) {
				return { action: 'cancel' };
			}

			return {
				action: 'regenerate',
				context: context && typeof context === 'string' ? context.trim() || undefined : undefined,
			};
		}

		return { action: 'confirm', message };
	}

	// Multiple messages case
	if (skipConfirm) {
		return { action: 'confirm', message: messages[0] };
	}

	if (!isInteractive) {
		throw new KnownError('Interactive terminal required for commit message selection. Use --confirm flag to skip selection and use the first message.');
	}

	const selected = await select({
		message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
		options: [
			...messages.map((value) => ({ label: value, value })),
			{ label: dim('─────────────────────'), value: 'separator', disabled: true } as any,
			{ label: `Regenerate all ${dim('(r)')}`, value: 'regenerate' },
			{ label: 'Cancel', value: 'cancel' },
		],
	});

	if (isCancel(selected) || selected === 'cancel') {
		return { action: 'cancel' };
	}

	if (selected === 'regenerate') {
		const context = await text({
			message: `Add context for regeneration ${dim('(optional, press Enter to skip)')}:`,
			placeholder: 'e.g., "focus on the bug fix" or "be more specific"',
		});

		if (isCancel(context)) {
			return { action: 'cancel' };
		}

		return {
			action: 'regenerate',
			context: context && typeof context === 'string' ? context.trim() || undefined : undefined,
		};
	}

	return { action: 'confirm', message: selected as string };
};