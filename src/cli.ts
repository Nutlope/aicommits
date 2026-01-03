import { cli } from 'cleye';
import updateNotifier from 'update-notifier';
import pkg from '../package.json';
const { description, version } = pkg;
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import setupCommand from './commands/setup.js';
import modelCommand from './commands/model.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';
import prCommand from './commands/pr.js';

const notifier = updateNotifier({
	pkg,
	distTag: version.includes('-') ? 'develop' : 'latest',
});

if (version !== '0.0.0-semantic-release' && version.includes('-')) {
	notifier.notify();
}

const rawArgv = process.argv.slice(2);

cli(
	{
		name: 'aicommits',

		/**
		 * Since this is a wrapper around `git commit`,
		 * flags should not overlap with it
		 * https://git-scm.com/docs/git-commit
		 */
		flags: {
			generate: {
				type: Number,
				description:
					'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
				alias: 'g',
			},
			exclude: {
				type: [String],
				description: 'Files to exclude from AI analysis',
				alias: 'x',
			},
			all: {
				type: Boolean,
				description:
					'Automatically stage changes in tracked files for the commit',
				alias: 'a',
				default: false,
			},
			type: {
				type: String,
				description:
					'Git commit message format (default: conventional). Supports conventional and gitmoji',
				alias: 't',
			},
			confirm: {
				type: Boolean,
				description:
					'Skip confirmation when committing after message generation (default: false)',
				alias: 'y',
				default: false,
			},
			clipboard: {
				type: Boolean,
				description:
					'Copy the selected message to the clipboard instead of committing (default: false)',
				alias: 'c',
				default: false,
			},
			version: {
				type: Boolean,
				description: 'Show version number',
				alias: 'v',
			},
		},

		commands: [configCommand, setupCommand, modelCommand, hookCommand, prCommand],

		help: {
			description,
		},

		ignoreArgv: (type) => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
		if (argv.flags.version) {
			console.log(version);
			process.exit(0);
		}

	if (isCalledFromGitHook()) {
		prepareCommitMessageHook();
	} else {
		aicommits(
			argv.flags.generate,
			argv.flags.exclude,
			argv.flags.all,
			argv.flags.type,
			argv.flags.confirm,
			argv.flags.clipboard,
			rawArgv
		);
	}
	},
	rawArgv
);
