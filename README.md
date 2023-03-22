<div align="center">
  <div>
    <img src=".github/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
	<p>A CLI that writes your git commit messages for you with AI. Never write a commit message again.</p>
	<a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/v/aicommits" alt="Current version"></a>
</div>

---

## Setup

> The minimum supported version of Node.js is the latest v14. Check your Node.js version with `node --version`.


1. Install _aicommits_:

    ```sh
    npm install -g aicommits
    ```

2. Retrieve your API key from [OpenAI](https://platform.openai.com/account/api-keys)

    > Note: If you haven't already, you'll have to create an account and set up billing.

3. Set the key so aicommits can use it:

    ```sh
    aicommits config set OPENAI_KEY=<your token>
    ```

    This will create a `.aicommits` file in your home directory.


### Upgrading

Check the installed version with:
```
aicommits --version
```

If it's not the [latest version](https://github.com/Nutlope/aicommits/releases/latest), run:

```sh
npm update -g aicommits
```

## Usage
### CLI mode

You can call `aicommits` directly to generate a commit message for your staged changes:

```sh
git add <files...>
aicommits
```

`aicommits` passes down unknown flags to `git commit`, so you can pass in [`commit` flags](https://git-scm.com/docs/git-commit) (with some exceptions (e.g. `--all`):

```sh
aicommits --dry-run
```

> 👉 **Tip:** Use the `aic` alias if `aicommits` is too long for you.

### Git hook

You can also integrate _aicommits_ with Git via the [`prepare-commit-msg`](https://git-scm.com/docs/githooks#_prepare_commit_msg) hook. This lets you use Git like you normally would, and edit the commit message before committing.

#### Install

In the Git repository you want to install the hook in:
```sh
aicommits hook install
```

#### Uninstall
In the Git repository you want to uninstall the hook from:

```sh
aicommits hook uninstall
```

#### Usage

1. Stage your files and commit:
    ```sh
    git add <files...>
    git commit # Only generates a message when it's not passed in
    ```

    > If you ever want to write your own message instead of generating one, you can simply pass one in: `git commit -m "My message"`

2. Aicommits will generate the commit message for you and pass it back to Git. Git will open it with the [configured editor](https://docs.github.com/en/get-started/getting-started-with-git/associating-text-editors-with-git) for you to review/edit it.

3. Save and close the editor to commit!

### Language support
Language support via locale config. [language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
```sh
aicommits config set locale=<language code>
```



## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Maintainers

- **Hassan El Mghari**: [@Nutlope](https://github.com/Nutlope) [<img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/nutlope)


- **Hiroki Osame**: [@privatenumber](https://github.com/privatenumber) [<img src="https://img.shields.io/twitter/follow/privatenumbr?style=flat&label=privatenumbr&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/privatenumbr)


## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/Nutlope/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project.
