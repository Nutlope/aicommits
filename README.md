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

## How it works

This CLI tool runs `git diff` to grab all the latest changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

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
- Solve latency issue (use a githook to asynchronously run gpt3 call on every git add, store the result in a temp file (or in the .git folder)
- Use gpt-3-tokenizer
- Add automated github releases
- Add opt-in emoji flag
- Add opt-in languages flag
- Build landing page for the 2.0 launch
