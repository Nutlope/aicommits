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
			useSemantic: {
				type: Boolean,
				description: `Whether to return a semantic git commit log. E.g:
feat: added some-feature to some-component
fix: fixed bug-xyz`,
				alias: 's' 
			}
		},

		commands: [
			configCommand,
			hookCommand,
		],

		help: {
			description,
		},

		ignoreArgv: type => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
		if (isCalledFromGitHook) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.useSemantic,
				rawArgv,
			);
		}
	},
	rawArgv,
);
