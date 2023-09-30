import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, select, confirm, isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
	getCurrentBranchName,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage } from '../utils/openai.js';
import { KnownError, handleCliError } from '../utils/error.js';

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	rawArgv: string[],
) => (async () => {
	intro(bgCyan(black(' aicommits ')));

	await assertGitRepo();

	const detectingFiles = spinner();

	if (stageAll) {
		// This should be equivalent behavior to `git commit --all`
		await execa('git', ['add', '--update']);
	}

	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff(excludeFiles);

	if (!staged) {
		detectingFiles.stop('Detecting staged files');
		throw new KnownError('No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.');
	}

	detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${staged.files.map(file => `     ${file}`).join('\n')
		}`);

	const { env } = process;
	const config = await getConfig({
		OPENAI_KEY: env.OPENAI_KEY || env.OPENAI_API_KEY,
		proxy: env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
		generate: generate?.toString(),
		type: commitType?.toString(),
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
			config['max-length'],
			config.type,
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
		const confirmed = await confirm({
			message: `Use this commit message?\n\n   ${message}\n`,
		});

		if (!confirmed || isCancel(confirmed)) {
			outro('Commit cancelled');
			return;
		}
	} else {
		const selected = await select({
			message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
			options: messages.map(value => ({ label: value, value })),
		});

		if (isCancel(selected)) {
			outro('Commit cancelled');
			return;
		}

		message = selected;
	}

	await execa('git', ['commit', '-m', message, ...rawArgv]);

	outro(`${green('✔')} Successfully committed!`);

	if (config['auto-push-current-branch'] === false && config['ask-push-current-branch'] === false) {
		return;
	}

	const currentBranch = await getCurrentBranchName();

	if (config['ask-push-current-branch']) {
		const confirmedPush = await confirm({
			message: `Push this commit to you current branch (${currentBranch})?\n\n`,
		});

		if (!confirmedPush || isCancel(confirmedPush)) {
			outro('Pushed skipped!');
			return;
		}
	}

	await execa('git', ['push', 'origin']);
	outro(`${green('✔')} Changes pushed to branch ${green(currentBranch)} !`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
