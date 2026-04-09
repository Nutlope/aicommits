import { KnownError } from './error.js';
import { isInteractive } from './headless.js';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type UsageData = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
};

export const normalizeUsage = (usage: unknown): UsageData => {
	const u = usage as Record<string, unknown> | undefined;
	return {
		prompt_tokens: (u?.prompt_tokens ?? u?.promptTokens ?? 0) as number,
		completion_tokens: (u?.completion_tokens ?? u?.completionTokens ?? 0) as number,
		total_tokens: (u?.total_tokens ?? u?.totalTokens ?? 0) as number,
	};
};

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
	const { select, confirm, isCancel } = await import('@clack/prompts');
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
		const confirmed = await confirm({
			message: 'Use this commit message?',
		});

		return confirmed && !isCancel(confirmed) ? message : null;
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
		options: messages.map((value) => ({ label: value, value })),
	});

	return isCancel(selected) ? null : (selected as string);
};
