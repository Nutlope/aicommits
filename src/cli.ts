#!/usr/bin/env node

import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { Configuration, OpenAIApi } from 'openai';

const OPENAI_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;

const generateCommitMessage = async (apiKey: string, prompt: string) => {
  const openai = new OpenAIApi(new Configuration({ apiKey }));
  try {
    const completion = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt,
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_tokens: 200,
      stream: false,
      n: 1,
    });

    return completion.data.choices[0].text!.trim().replace(/[\n\r]/g, '');
  } catch (error) {
    const errorAsAny = error as any;
    errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
    throw errorAsAny;
  }
};

(async () => {
  console.log(chalk.white('▲ ') + chalk.green('Welcome to AICommits!'));

  if (!OPENAI_KEY) {
    console.error(
      `${chalk.white(
        '▲ '
      )}Please save your OpenAI API key as an env variable by doing 'export OPENAI_KEY=YOUR_API_KEY'`
    );
    process.exit(1);
  }
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf8',
      stdio: 'ignore',
    });
  } catch {
    console.error(`${chalk.white('▲ ')}This is not a git repository`);
    process.exit(1);
  }

  const diff = execSync(
    'git diff --cached . ":(exclude)package-lock.json" ":(exclude)yarn.lock" ":(exclude)pnpm-lock.yaml"',
    {
      encoding: 'utf8',
    }
  );

  if (!diff) {
    console.log(
      `${chalk.white(
        '▲ '
      )}No staged changes found. Make sure there are changes and run \`git add .\``
    );
    process.exit(1);
  }

  // Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
  if (diff.length > 8000) {
    console.log(
      `${chalk.white('▲ ')}The diff is too large to write a commit message.`
    );
    process.exit(1);
  }

  const CLI_ARGS = process.argv.slice(2);
  let isLongArgSet = false;

  let prompt = `Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything: ${diff}`;

  if (
    CLI_ARGS.includes('--long') ||
    CLI_ARGS.includes('-l') ||
    CLI_ARGS.includes('--verbose') ||
    CLI_ARGS.includes('-v')
  ) {
    isLongArgSet = true;
    prompt = `Write a verbose Git commit message in a complete sentence in the present tense for the following diff without any preamble, providing with comprehensive information about the changes: ${diff}`;
  }

  console.log(
    chalk.white('▲ ') +
      chalk.gray(
        `Generating your AI commit message ${
          isLongArgSet
            ? 'with a verbose description'
            : 'with a concise description'
        }...\n`
      )
  );

  try {
    const aiCommitMessage = await generateCommitMessage(OPENAI_KEY, prompt);
    console.log(
      `${
        chalk.white('▲ ') + chalk.bold('Commit message: ') + aiCommitMessage
      }\n`
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

    execSync(`git commit -m "${aiCommitMessage}"`, {
      stdio: 'inherit',
      encoding: 'utf8',
    });
  } catch (error) {
    console.error(chalk.white('▲ ') + chalk.red(error.message));
    process.exit(1);
  }
})();
