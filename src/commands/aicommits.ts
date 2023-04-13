import {
	intro,
	isCancel,
	outro,
	select,
	spinner,
	text,
} from '@clack/prompts';
import { execa } from 'execa';
import {
	bgCyan,
	black, dim, green, red,
} from 'kolorist';
import { getConfig } from '../utils/config.js';
import { KnownError, handleCliError } from '../utils/error.js';
import {
	assertGitRepo,
	getDetectedMessage,
	getStagedDiff,
} from '../utils/git.js';
import { generateCommitMessage } from '../utils/openai.js';

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	rawArgv: string[],
) => (async () => {
	intro(bgCyan(black(' aicommits ')));
	await assertGitRepo();

	const detectingFiles = spinner();

	if (stageAll) {
		await execa('git', ['add', '--all']);
	}

	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff(excludeFiles);

	if (!staged) {
		detectingFiles.stop('Detecting staged files');
		throw new KnownError(
			'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.',
		);
	}

	detectingFiles.stop(
		`${getDetectedMessage(staged.files)}:\n${staged.files
			.map(file => `     ${file}`)
			.join('\n')}`,
	);

	const { env } = process;
	const config = await getConfig({
		OPENAI_KEY: env.OPENAI_KEY || env.OPENAI_API_KEY,
		proxy:
			env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
		generate: generate?.toString(),
	});

	const s = spinner();
	s.start('The AI is analyzing your changes');
	let messages: string[];
	try {
		messages = await generateCommitMessage(
			config.OPENAI_KEY,
			config.model,
			config.locale,
			staged.diff,
			config.generate,
			config.timeout,
			config.proxy,
		);
	} finally {
		s.stop('Changes analyzed');
	}

	if (messages.length === 0) {
		throw new KnownError('No commit messages were generated. Try again.');
	}

	let message: string;
	if (messages.length === 1) {
		[message] = messages;
		const selected = await select({
			message: `Here is the suggested commit message. Choose an action:\n\n   ${message}\n`,
			options: ['Commit', 'Edit message'].map(value => ({ label: value, value })),
		});

		if (isCancel(selected)) {
			outro('Commit cancelled');
			return;
		}

		if (selected === 'Edit message') {
			const updatedMessage = await text({
				message: 'Edit commit message',
				initialValue: message,
				placeholder: 'Add a commit message here',
			});

			if (isCancel(updatedMessage)) {
				outro('Commit cancelled');
				return;
			}

			message = updatedMessage as string;
		}
	} else {
		const selectedMessage = await select({
			message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
			options: messages.map(value => ({ label: value, value })),
		});

		if (isCancel(selectedMessage)) {
			outro('Commit cancelled');
			return;
		}

		const selectedAction = await select({
			message: 'Choose an action?\n',
			options: ['Commit', 'Edit message'].map(value => ({ label: value, value })),
		});

		if (isCancel(selectedAction)) {
			outro('Commit cancelled');
			return;
		}

		message = selectedMessage as string;

		if (selectedAction === 'Edit message') {
			const updatedMessage = await text({
				message: 'Edit commit message',
				initialValue: selectedMessage as string,
				placeholder: 'Add a commit message here',
			});

			if (isCancel(updatedMessage)) {
				outro('Commit cancelled');
				return;
			}
			message = updatedMessage as string;
		}
	}

	await execa('git', ['commit', '-m', message, ...rawArgv]);

	outro(`${green('✔')} Successfully committed!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
