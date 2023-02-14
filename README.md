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

## Setup
This CLI generates the commit message by sending the diff to the [OpenAI API](https://openai.com/api/).

You'll need to sign up for an account to obtain an API key.

Note: The API is not free and costs a few cents per request. However, OpenAI gives you $18 of free credits to get started.

## Usage

When you want to make a commit, stage your changes and run:
```
OPENAI_KEY=<token> npx aicommits
```

If you have a `.env` file, you can also set the `OPENAI_KEY` variable there. Alternatively, you can also store it in your `.zshrc` or `.bashrc` files.

### Global install

By installing the package globally, you can use it without npx:
```
npm install -g aicommits
```

npx will fetch the latest version for you, but when globally installed, you'll have re-run the command to update the package.

## How does this work?

This tool runs `git diff --cahed` to grab the staged changes, sends them to the OpenAI API, then returns the AI generated commit message.

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
- Add opt-in emoji flag
- Add opt-in languages flag
- Build landing page for the 2.0 launch

## Contributing

See the [Contributin guide](.github/CONTRIBUTING.md).
