<div align="center">
  <div>
    <img src=".github/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
	<p>A CLI that writes your git commit messages for you with AI. Never write a commit message again.</p>
	<a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/v/aicommits" alt="Current version"></a>
  <a href="https://twitter.com/nutlope">
    <img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" alt="Hassan Twitter follower count" />
  </a>
</div>

---

## Installation and Usage

Install the CLI then grab your [OpenAI key](https://openai.com/api/) and add it as an env variable with the two commands below.

1. `npm install -g aicommits`
2. `export OPENAI_KEY=sk-xxxxxxxxxxxxxxxx`

It's recommended to add the line in #2 to your `.zshrc` or `.bashrc` so it persists instead of having to define it in each terminal session.

After doing the two steps above, generate your commit by running `aicommits`.

> Note: If you get a EACCESS error on mac/linux when running the first command, try running it with `sudo npm install -g aicommits`.

## Using the `--long` or `--verbose` Flag

By default, the AI Commits CLI generates concise commit messages. However, if you want to generate a longer commit message that provides more comprehensive information about the changes, you can use the --long or --verbose flags.

To use the --long or --verbose flag, simply add it to the end of the command:

```bash
aicommits --long
```

You can also use the short forms -l and -v:

```bash
aicommits -v
```

When the --long or --verbose flag is set, the AI Commits CLI will generate a more detailed commit message that provides comprehensive information about the changes. This can be useful when you want to provide more context for a particular commit.

## How it works

This CLI tool runs a `git diff` command to grab all the latest changes, sends this to OpenAI's GPT-3, then returns the AI generated commit message. I also want to note that it does cost money since GPT-3 generations aren't free. However, OpenAI gives folks $18 of free credits and commit message generations are cheap so it should be free for a long time.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Limitations

- Only supports git diffs of up to 200 lines of code for now
- Does not support conventional commits

The next version of the CLI, version 2, will address both of these limitations as well as the tasks below!

## Future tasks

- Add a debugging flag to troubleshoot OpenAI responses
- Add support for conventional commits as a flag that users can enable
- Add support for diffs greater than 200 lines by grabbing the diff per file
- Add support for a flag that can auto-accept
- Add ability to specify a commit message from inside aicommit
- Use gpt-3-tokenizer
- Add automated github releases
- Add opt-in emoji flag
- Add opt-in languages flag
- Build landing page for the 2.0 launch
