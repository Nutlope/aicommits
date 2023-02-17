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

1. Install the CLI:

   ```sh
   npm install -g aicommits
   ```

2. Retrieve your API key from [OpenAI](https://platform.openai.com/account/api-keys)

   > Note: If you haven't already, you'll have to create an account and set up billing.

3. Set the key so aicommits can use it:

   ```sh
   echo "OPENAI_KEY=<your token>" >> ~/.aicommits
   ```

4. You're ready to go!

   Run `aicommits` in any Git repo and it will generate a commit message for you.

5. Enable non-interactive mode to use automatically the commit retrieved withot review:
  `aicommits -y` or `aicommits --noninteractive`

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Future tasks

- Add support for conventional commits as a flag that users can enable
- Add support for diffs greater than 200 lines by grabbing the diff per file, optional flag
- Add ability to specify a commit message from inside aicommit if user doesn't like generated one
- Solve latency issue (use a githook to asynchronously run gpt3 call on every git add, store the result in a temp file or in the .git folder). Put behind a flag
- Use gpt-3-tokenizer instead of hard limit on characters as a more accurate model
- Play around with prompt to produce optimal result
- Add opt-in emoji flag to preface commits with an emoji, use [this](https://gitmoji.dev) as a guide
- Add opt-in languages flag where it returns the commit in different languages
- Add automated github releases using [this action](https://github.com/manovotny/github-releases-for-automated-package-publishing-action)
- Build landing page for the 2.0 launch

## Maintainers

- **Hassan El Mghari**: [GitHub](https://github.com/Nutlope) | [Twitter](https://twitter.com/nutlope)
- **Hiroki Osame**: [GitHub](https://github.com/privatenumber) | [Twitter](https://twitter.com/privatenumbr)
