import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, select, isCancel,
} from '@clack/prompts';
import clipboard from 'clipboardy';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage } from '../utils/openai.js';

export default async (
	generate: number,
	rawArgv: string[],
) => (async () => {
	intro(bgCyan(black(' aicommits ')));

	await assertGitRepo();

	const detectingFiles = spinner();
	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff();

	if (!staged) {
		throw new Error('No staged changes found. Make sure to stage your changes with `git add`.');
	}

	detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${
		staged.files.map(file => `     ${file}`).join('\n')
	}`);

	const config = await getConfig();
	const OPENAI_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? config.OPENAI_KEY;
	if (!OPENAI_KEY) {
		throw new Error('Please set your OpenAI API key in ~/.aicommits');
	}

	const s = spinner();
	s.start('The AI is analyzing your changes');
	const messages = await generateCommitMessage(
		OPENAI_KEY,
		staged.diff,
		generate,
	);
	s.stop('Changes analyzed');

	const copyMessage = 'No, but copy the message to clipboard';
	const yesMessage = 'Yes';
	const noMessage = 'No';
	const candidates = [yesMessage, noMessage, copyMessage];

	let message;
	if (messages.length === 1) {
		[message] = messages;

		const selected = await select({
			message: `Use this commit message? ${dim('(Ctrl+c to exit)')} \n\n   ${message}\n`,
			options: candidates.map(value => ({ label: value, value })),
		});

		if (isCancel(selected) || selected === noMessage) {
			outro('Commit cancelled');
			return;
		}
		if (selected === copyMessage) {
			clipboard.writeSync(message);
			outro('Copied to clipboard successfully');
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
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	process.exit(1);
});
