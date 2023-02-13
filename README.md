# AI Commits

AI Commits is a tool that writes your git commit messages for you. Never write a commit message again.

![AI Commit Screenshot](https://github.com/Nutlope/aicommits/blob/main/screenshot.png)

## Installation and Usage

Install the CLI then grab your [OpenAI key](https://openai.com/api/) and add it as an environment variable.

1. `npm install -g aicommits`
2. `export OPENAI_KEY=sk-xxxxxxxxxxxxxxxx`

After that, use this CLI by simply running `aicommits` to generate your commit.

> Note: If you get a EACCESS error on mac/linux when running the first command, try running it with `sudo npm install -g aicommits` and putting in your password.

## How it works

This CLI tool runs a `git diff` command to grab all the latest changes, sends this to OpenAI's GPT-3, then returns the AI generated commit message. Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Limitations

- Only supports git diffs of up to 200 lines of code for now
- Does not support conventional commits

The next version of the CLI, v2, will address both of these limitations!

## Future tasks

- Add support for conventional commits as a flag that users can enable
- Try supporting more than 200 lines by grabbing the diff per file
- Experiment with openai curie and codex as opposed to dacinvi
- Build landing page for the 2.0 launch
