import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, select, confirm, isCancel,
} from '@clack/prompts';
import { cli } from 'cleye';
import { description, version } from '../package.json';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
} from './utils/git.js';
import { getConfig } from './utils/config.js';
import { generateCommitMessage } from './utils/openai.js';
import configCommand from './commands/config.js';

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
				description: 'Number of messages to generate. (Warning: generating multiple costs more)',
				alias: 'g',
				default: 1,
			},
		},

		commands: [
			configCommand,
		],

		help: {
			description,
		},

		ignoreArgv: type => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
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
			const messages = await generateCommitMessage(
				OPENAI_KEY,
				staged.diff,
				argv.flags.generate,
			);
			s.stop('Changes analyzed');

			let message;
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
		})().catch((error) => {
			outro(`${red('✖')} ${error.message}`);
			process.exit(1);
		});
	},
	rawArgv,
);
