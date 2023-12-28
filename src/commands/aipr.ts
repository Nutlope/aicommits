import { command } from 'cleye';
import { execa } from 'execa';
import {
	black,
	dim,
	green,
	red,
	bgCyan,
} from 'kolorist';
import {
	intro,
	outro,
	spinner,
	select,
	confirm,
	isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getDetectedMessage,
	getStagedDiffFromTrunk,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generatePullRequest } from '../utils/openai.js';
import { KnownError, handleCliError } from '../utils/error.js';

export default command(
	{
		name: 'pr',
		/**
		 * Since this is a wrapper around `gh pr create`,
		 * flags should not overlap with it
		 * https://cli.github.com/manual/gh_pr_create
		 */
		flags: {
			generate: {
				type: Number,
				description: 'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
				alias: 'g',
			},
			trunkBranch: {
				type: String,
				description: 'The branch into which you want your code merged',
				alias: 'B',
			},
			exclude: {
				type: [String],
				description: 'Files to exclude from AI analysis',
				alias: 'x',
			},
			all: {
				type: Boolean,
				description: 'Automatically stage changes in tracked files for the commit',
				alias: 'A',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			const {
				all: stageAll,
				exclude: excludeFiles,
				trunkBranch: trunk,
				generate,
			} = argv.flags;

			intro(bgCyan(black(' aipr ')));
			await assertGitRepo();

			const detectingFiles = spinner();

			if (stageAll) {
				// This should be equivalent behavior to `git commit --all`
				await execa('git', ['add', '--update']);
			}

			detectingFiles.start('Detecting staged files');
			const staged = await getStagedDiffFromTrunk(trunk, excludeFiles);

			if (!staged) {
				detectingFiles.stop('Detecting staged files');
				throw new KnownError(
					'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.',
				);
			}

			detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${staged.files.map(file => `     ${file}`).join('\n')}`);

			const { env } = process;
			const config = await getConfig({
				OPENAI_KEY: env.OPENAI_KEY || env.OPENAI_API_KEY,
				proxy:
					env.https_proxy
					|| env.HTTPS_PROXY
					|| env.http_proxy
					|| env.HTTP_PROXY,
				generate: generate?.toString(),
			});

			const s = spinner();
			s.start('The AI is analyzing your changes');
			let messages: string[];
			try {
				messages = await generatePullRequest(
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
				throw new KnownError('A PR was not generated. Try again.');
			}

			let message: string;
			if (messages.length === 1) {
				[message] = messages;
				const confirmed = await confirm({
					message: `Use this PR?\n\n   ${message}\n`,
				});

				if (!confirmed || isCancel(confirmed)) {
					outro('PR cancelled');
					return;
				}
			} else {
				const selected = await select({
					message: `Pick a PR to use: ${dim('(Ctrl+c to exit)')}`,
					options: messages.map(value => ({ label: value, value })),
				});

				if (isCancel(selected)) {
					outro('PR cancelled');
					return;
				}

				message = selected;
			}

			await execa('gh', ['pr', 'create', '-b', `${message}`, '-t', `${message.split('\n')[0]}`, '-B', trunk ?? 'main']);

			outro(`${green('✔')} Successfully created!`);
		})().catch((error) => {
			console.error(`${red('✖')} ${error.message}`);
			handleCliError(error);
			process.exit(1);
		});
	},
);
