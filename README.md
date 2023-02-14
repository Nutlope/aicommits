<div align="center">
  <div>
    <img src="/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
	<p>A CLI that writes your git commit messages for you. Never write a commit message again.</p>
	<a href="https://packagephobia.com/result?p=aicommits"><img src="https://badgen.net/packagephobia/install/aicommits" alt="Current version"></a>
	<a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/v/aicommits" alt="Install size"></a>
  <a href="https://twitter.com/nutlope">
    <img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" alt="Hassan Twitter follower count" />
  </a>
</div>

---

## Installation and Usage

Install the CLI then grab your [OpenAI key](https://openai.com/api/) and add it as an env variable with the two commands below.

1. `npm install -g aicommits`
2. `export OPENAI_KEY=sk-xxxxxxxxxxxxxxxx`

After that, generate your commit running `aicommits`.

> Note: If you get a EACCESS error on mac/linux when running the first command, try running it with `sudo npm install -g aicommits` and putting in your password.

## How it works

This CLI tool runs a `git diff` command to grab all the latest changes, sends this to OpenAI's GPT-3, then returns the AI generated commit message. Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Limitations

- Only supports git diffs of up to 200 lines of code for now
- Does not support conventional commits

The next version of the CLI, v2, will address both of these limitations!

## Future tasks

- Ignore package-lock and yarn.lock files
- Experiment with openai curie and codex as opposed to dacinvi
  - Figure out the price per commit
- Add support for conventional commits as a flag that users can enable
- Try supporting more than 200 lines by grabbing the diff per file
- Build landing page for the 2.0 launch
