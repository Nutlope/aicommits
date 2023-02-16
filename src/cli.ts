import { execa } from 'execa';
import {
	black, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, confirm, isCancel,
} from '@clack/prompts';
import {
	getConfig,
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
	generateCommitMessage,
} from './utils.js';

(async () => {
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
	const message = await generateCommitMessage(OPENAI_KEY, staged.diff);
	s.stop('The commit message is ready for review');

	const confirmed = await confirm({
		message: `Would you like to commit with this message:\n\n   ${message}\n`,
	});

	if (!confirmed || isCancel(confirmed)) {
		outro('Commit cancelled');
		return;
	}

	await execa('git', ['commit', '-m', message], {
		stdio: 'inherit',
	});

	outro(`${green('✔')} Successfully committed!}`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	process.exit(1);
});
