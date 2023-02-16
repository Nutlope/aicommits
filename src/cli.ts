import { execa } from 'execa';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
	getConfig,
	assertGitRepo,
	getStagedDiff,
	generateCommitMessage,
} from './utils.js';

(async () => {
	console.log(chalk.white('▲ ') + chalk.green('Welcome to AICommits!'));

	await assertGitRepo();

	const staged = await getStagedDiff();
	if (!staged) {
		throw new Error('No staged changes found. Make sure to stage your changes with `git add`.');
	}

	const config = await getConfig();
	const OPENAI_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? config.OPENAI_KEY;

	if (!OPENAI_KEY) {
		throw new Error('Please set your OpenAI API key in ~/.aicommits');
	}

	console.log(
		chalk.white('▲ ') + chalk.gray('Generating your AI commit message...\n'),
	);
	const aiCommitMessage = await generateCommitMessage(OPENAI_KEY, staged.diff);
	console.log(
		`${chalk.white('▲')} ${chalk.bold('Commit message:')} ${aiCommitMessage}\n`,
	);

	const confirmationMessage = await inquirer.prompt([
		{
			name: 'useCommitMessage',
			message: 'Would you like to use this commit message? (Y / n)',
			choices: ['Y', 'y', 'n'],
			default: 'y',
		},
	]);

	if (confirmationMessage.useCommitMessage === 'n') {
		console.log(`${chalk.white('▲ ')}Commit message has not been commited.`);
		return;
	}

	await execa('git', ['commit', '-m', aiCommitMessage], {
		stdio: 'inherit',
	});
})().catch((error) => {
	console.error(`${chalk.white('▲')} ${error.message}`);
	process.exit(1);
});;
