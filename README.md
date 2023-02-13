# AI Commits - work in progress

AI Commits is a tool that writes your git commit messages for you. Never write a commit message again.

[![AI Commit Screenshot](https://github.com/Nutlope/aicommits/blob/main/screenshot.png)](https://twitter.com/nutlope/status/1624646872890589184)

## How to install

1. `npm install -g autocommit`
2. `export OPENAIKEY=sk-xxxxxxxxxxxxxxxx`
3. `autocommit` after you run `git add .`

## How it works

This CLI tool runs a `git diff` command to grab all the latest changes, sends this to OpenAI's GPT-3, then returns the AI generated commit message. Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Limitations

It currently can only support git diffs of up to 200 lines of code. I'm working on version 2.0 which will be TypeScript-first, support conventional commits, and support long diffs.

## Remaining tasks

Now:

- Rewrite this in node to publish as an npm package
  - Figure out how to fail gracefully instead of exit 1

Future tasks:

- Experiment with openai curie and/or codex
- Add conventional commit support
- Try supporting more than 200 lines by grabbing the diff per file
- Rewrite in TypeScript
- Build landing page for the 2.0 launch
