# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`aicommits` is a CLI tool that uses OpenAI's GPT models to automatically generate git commit messages based on staged changes. The project is written in TypeScript using ES modules and targets Node.js v14+.

## Development Commands

### Setup
```sh
pnpm i                    # Install dependencies
```

### Build
```sh
pnpm build                # Build using pkgroll (Rollup-based bundler)
pnpm build -w             # Watch mode for development
```

### Testing
```sh
pnpm test                                   # Run tests (without OpenAI integration)
OPENAI_KEY=<key> pnpm test                  # Run full tests including OpenAI integration
```

### Type Checking
```sh
pnpm type-check           # Run TypeScript compiler for type validation
```

### Running Locally
```sh
./dist/cli.mjs            # Run built CLI directly (Unix)
node ./dist/cli.mjs       # Run built CLI (cross-platform)
```

## Architecture

### Entry Point & CLI Structure
- `src/cli.ts`: Main entry point using the `cleye` CLI framework
- The CLI has two execution modes:
  1. **Direct mode**: When invoked as `aicommits` command
  2. **Git hook mode**: When invoked from the `prepare-commit-msg` Git hook

### Command Flow
```
cli.ts → detects execution context
├─ Git hook mode → prepare-commit-msg-hook.ts
└─ CLI mode → aicommits.ts → OpenAI integration
```

### Core Commands
1. **Main command** (`src/commands/aicommits.ts`): Analyzes staged changes and generates commit messages
   - Gets staged diff via `git diff --cached`
   - Calls OpenAI API with the diff
   - Presents generated messages for user selection
   - Executes `git commit` with chosen message

2. **Config command** (`src/commands/config.ts`): Manages configuration stored in `~/.aicommits`
   - Uses INI format for config file
   - Supports get/set operations for all config keys

3. **Hook command** (`src/commands/hook.ts`): Installs/uninstalls Git hooks
   - Creates symlink to CLI in `.git/hooks/prepare-commit-msg`
   - Windows uses a Node.js wrapper script instead of symlink

### Utilities
- `utils/openai.ts`: Direct HTTPS integration with OpenAI Chat Completions API (no SDK)
  - Manual HTTP client using Node.js `https` module
  - Supports proxy configuration
  - Token counting with `@dqbd/tiktoken`

- `utils/config.ts`: Configuration management with validation
  - Config keys: `OPENAI_KEY`, `locale`, `generate`, `type`, `proxy`, `model`, `timeout`, `max-length`
  - Parsers enforce type safety and validation rules

- `utils/git.ts`: Git operations via `execa`
  - Stage detection, diff retrieval, repository validation

- `utils/prompt.ts`: Prompt generation for OpenAI
  - Supports conventional commits format
  - Locale-aware prompts

### Key Technical Details

1. **Module System**: Pure ES modules (`"type": "module"` in package.json)
   - All imports use `.js` extensions (TypeScript convention for ES modules)
   - tsconfig uses `"module": "Node16"`

2. **Build System**: `pkgroll` infers entry points from `package.json#bin`
   - Automatically adds Node.js hashbang (`#!/usr/bin/env node`)
   - Minifies output
   - Produces `dist/cli.mjs`

3. **Dual Binary Names**: Both `aicommits` and `aic` alias to the same CLI

4. **Config Storage**: INI file at `~/.aicommits` (home directory)

5. **Git Hook Detection**: Detects hook invocation by checking if `process.argv[1]` ends with `.git/hooks/prepare-commit-msg`

6. **UI Framework**: Uses `@clack/prompts` for interactive CLI prompts with spinners and confirmation dialogs

## Testing Strategy

- Test framework: `manten`
- Test runner: `tsx` (TypeScript executor)
- Tests require an actual OpenAI API key for full coverage
- Test structure: `tests/specs/` contains test suites organized by feature
- Fixtures: `tests/fixtures/` for test data

## Important Patterns

1. **Error Handling**: Uses custom `KnownError` class for user-facing errors vs unexpected errors
2. **Async/Await**: All commands wrapped in async IIFE with catch blocks
3. **Git Integration**: All git commands use `execa` for process execution
4. **Proxy Support**: Full HTTPS proxy support via `https-proxy-agent`
5. **Flag Passthrough**: Unknown CLI flags are passed directly to `git commit` (via `ignoreArgv` in cleye config)
