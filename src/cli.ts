import { cli } from 'cleye';
import { description, version } from '../package.json';
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';

const rawArgv = process.argv.slice(2);

cli(
	{
		name: 'aicommits',

		version,

		/**
		 * Since this is a wrapper around `git commit`,
		 * flags should not overlap with it
		 * https://git-scm.com/docs/git-commit
		 */
		flags: {
			generate: {
				type: Number,
				description: 'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
				alias: 'g',
			},
			exclude: {
				type: [String],
				description: 'Files to exclude from AI analysis',
				alias: 'x',
			},
			all: {
				type: Boolean,
				description: 'Automatically stage changes in tracked files for the commit',
				alias: 'a',
				default: false,
			},
		},

		commands: [
			configCommand,
			hookCommand,
		],

		help: {
			description,
		},

		ignoreArgv: type => type === 'unknown-flag' || type === 'argument',
		noninteractive: {
			type: Boolean,
			description: 'Non interactive mode',
			alias: 'y',
			default: false,
		}
	},
	(argv) => {
		if (isCalledFromGitHook) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.all,
				rawArgv,
			);
		}
	},
	rawArgv,
);

(async () => {
	intro(bgCyan(black(' aicommits ')));

	await assertGitRepo();

	const detectingFiles = spinner();
	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff();

	if (!staged) {
		throw new Error('No staged changes found. Make sure to stage your changes with `git add`.');
	}

	detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${staged.files.map(file => `     ${file}`).join('\n')
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
		argv.flags.generate,
	);
	s.stop('Changes analyzed');

	let message;
	if (messages.length === 1) {
		[message] = messages;
		// If non-interactive mode auto confirm the commit
		const confirmed = argv.flags.noninteractive ? true : await confirm({
			message: `Use this commit message?\n\n   ${message}\n`,
		});

		if (!confirmed || isCancel(confirmed)) {
			outro('Commit cancelled');
			return;
		}
	} else {
		// If non-interactive mode auto confirm the first commit message
		const selected = argv.flags.noninteractive ? messages[1] : await select({
			message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
			options: messages.map(value => ({ label: value, value })),
		});

		if (isCancel(selected)) {
			outro('Commit cancelled');
			return;
		}

		message = selected;
	}

	await execa('git', ['commit', '-m', message]);

	outro(`${green('✔')} Successfully committed!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	process.exit(1);
});
