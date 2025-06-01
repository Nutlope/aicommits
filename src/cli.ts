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
				description: 'Type of commit message to generate',
				alias: 't',
			},
		},

		commands: [configCommand, hookCommand],

		help: {
			description: `${description}

Examples:
  $ aicommits
  $ aicommits --all
  $ aicommits --generate 3
  $ aicommits --type conventional
  $ aicommits --exclude package-lock.json --exclude yarn.lock

Configuration:
  $ aicommits config set OPENAI_KEY=<your token>
  $ aicommits config set OPENROUTER_KEY=<your token>
  $ aicommits config set provider=openrouter
  $ aicommits config set openrouter_model=anthropic/claude-3-opus

Providers:
  - OpenAI (default)
    - Set OPENAI_KEY for API key
    - Use model config for model selection
  - OpenRouter
    - Set OPENROUTER_KEY for API key
    - Set provider=openrouter
    - Use openrouter_model config for model selection
    - Available models: openai/chatgpt-4-latest, anthropic/claude-3-opus, etc.
    - See https://openrouter.ai/docs#models for full list`,
		},

		ignoreArgv: (type) => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
		if (isCalledFromGitHook) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.all,
				argv.flags.type,
				rawArgv
			);
		}
	},
	rawArgv
);
