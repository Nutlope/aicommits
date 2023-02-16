#!/usr/bin/env node

import { execa } from 'execa';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
	getConfig,
	generateCommitMessage,
} from './utils.js';

(async () => {
	const config = await getConfig();
	const OPENAI_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? config.OPENAI_KEY;

	console.log(chalk.white('▲ ') + chalk.green('Welcome to AICommits!'));

	if (!OPENAI_KEY) {
		console.error(
			`${chalk.white('▲ ')
         }Please save your OpenAI API key as an env variable by doing 'export OPENAI_KEY=YOUR_API_KEY'`,
		);
		process.exit(1);
	}
	try {
		await execa('git', ['rev-parse', '--is-inside-work-tree']);
	} catch {
		console.error(`${chalk.white('▲ ')}This is not a git repository`);
		process.exit(1);
	}

	const { stdout: diff } = await execa(
		'git',
		['diff', '--cached', '.', ':(exclude)package-lock.json', ':(exclude)yarn.lock', ':(exclude)pnpm-lock.yaml'],
	);

	if (!diff) {
		console.log(
			`${chalk.white('▲ ')
         }No staged changes found. Make sure there are changes and run \`git add .\``,
		);
		process.exit(1);
	}

	// Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
	if (diff.length > 8000) {
		console.log(
			`${chalk.white('▲ ')}The diff is too large to write a commit message.`,
		);
		process.exit(1);
	}

	const prompt = `I want you to act like a git commit message writer. I will input a git diff and your job is to convert it into a useful commit message. Do not preface the commit with anything, use the present tense, return a complete sentence, and do not repeat yourself: ${diff}`;

	console.log(
		chalk.white('▲ ') + chalk.gray('Generating your AI commit message...\n'),
	);

	try {
		const aiCommitMessage = await generateCommitMessage(OPENAI_KEY, prompt);
		console.log(
			`${chalk.white('▲ ') + chalk.bold('Commit message: ') + aiCommitMessage
		}\n`,
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
			process.exit(1);
		}

		await execa('git', ['commit', '-m', aiCommitMessage], {
			stdio: 'inherit',
		});
	} catch (error) {
		console.error(chalk.white('▲ ') + chalk.red((error as any).message));
		process.exit(1);
	}
})();
