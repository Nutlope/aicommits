import {
	dim, black, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, select, text, isCancel,
} from '@clack/prompts';
import { execa } from 'execa';
import {
	getConfig,
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
	getCommitMessages,
} from './utils.js';

(async () => {
	if (process.argv.includes('--help')) {
		console.log(`
		aicommits

		https://npmjs.com/package/aicommits

		Usage:
		Run \`aicommits\` for an AI generated commit message based on the staged files.
		
		Prerequisites:
		\`OPENAI_KEY\` environment variable containing the OpenAI API key (.env supported)
		`.replace(/^\t+/gm, '').trim());
		return;
	}

	intro(bgCyan(black(' aicommits ')));

	const config = await getConfig();
	const OPENAI_KEY = process.env.OPENAI_KEY || config.OPENAI_KEY;

	if (!OPENAI_KEY) {
		throw new Error('Environment variable OPENAI_KEY not found!');
	}

	await assertGitRepo();

	const detectingFiles = spinner();
	detectingFiles.start('Detecting staged files');
	const stagedDiff = await getStagedDiff();

	if (!stagedDiff) {
		throw new Error('No staged changes found. Make sure to stage your changes with `git add`.');
	}

	detectingFiles.stop(`${getDetectedMessage(stagedDiff.files)}:\n${
		stagedDiff.files.map(file => `     ${file}`).join('\n')
	}`);

	const s = spinner();
	s.start('Generating commit messages');
	const messages = await getCommitMessages(OPENAI_KEY, stagedDiff.diff);
	s.stop('Generated commit messages');

	const commitMessage = await select({
		message: `Pick a commit message to edit: ${dim('(Ctrl+c to exit)')}`,
		options: messages.map(value => ({ label: value, value })),
	});

	if (isCancel(commitMessage)) {
		return;
	}

	const editedCommitMessage = await text({
		message: `Edit commit message and press Enter to commit: ${dim('(Ctrl+c to exit)')}`,
		initialValue: commitMessage,
	});

	if (isCancel(editedCommitMessage)) {
		return;
	}

	if (!editedCommitMessage.trim()) {
		throw new Error('Commit message cannot be empty');
	}

	const { stdout: commitOutput } = await execa('git', ['commit', '-m', editedCommitMessage]);

	outro(`${green('✔')} Successfully committed!\n\n${dim(commitOutput)}`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	process.exit(1);
});
