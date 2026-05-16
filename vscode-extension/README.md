# AI Commits VSCode Extension

Generate git commit messages using AI directly from VSCode's Git interface.

## Features

- Generate commit messages with a single click from the Source Control panel
- Support for plain, conventional, conventional+body, gitmoji, and subject+body commit formats
- Integrates seamlessly with VSCode's built-in Git extension
- Preview messages before committing or auto-commit option

## Requirements

- [aicommits CLI](https://github.com/anthropics/aicommits) must be installed and configured
- Run `aicommits setup` first to configure your AI provider

## Usage

1. Open the Source Control panel (Ctrl/Cmd + Shift + G)
2. Stage your changes
3. Click the sparkle icon in the toolbar or use the command palette:
   - `AI Commits: Generate Commit Message` - Plain format
   - `AI Commits: Generate Conventional Commit` - Conventional commits format
   - `AI Commits: Generate Conventional+Body Commit` - Conventional commits format with a body
   - `AI Commits: Generate Gitmoji Commit` - Gitmoji format
   - `AI Commits: Generate Subject+Body Commit` - Subject line with a body
4. The generated message appears in the commit input box
5. Review and commit!

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `aicommits.path` | `aicommits` | Path to the aicommits CLI binary |
| `aicommits.defaultType` | `plain` | Default commit message format (plain, conventional, conventional+body, gitmoji, subject+body) |
| `aicommits.autoCommit` | `false` | Auto-commit after generating (skips preview) |

## Commands

- `aicommits.generate` - Generate plain commit message
- `aicommits.generateConventional` - Generate conventional commit
- `aicommits.generateConventionalBody` - Generate conventional commit with body
- `aicommits.generateGitmoji` - Generate gitmoji commit
- `aicommits.generateSubjectBody` - Generate subject and body commit
- `aicommits.setup` - Setup AI provider (opens terminal)
- `aicommits.selectModel` - Select AI model (opens terminal)

## Installation

### From Source

```bash
cd vscode-extension
pnpm install
pnpm run compile
```

Then in VSCode:
1. Open the Extensions panel
2. Click "..." menu → "Install from VSIX..."
3. Select the `.vsix` file (run `pnpm run package` first)

## License

MIT
