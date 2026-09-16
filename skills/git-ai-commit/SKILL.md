---
name: git-ai-commit
description: Generate and optionally create Git commits with AI-assisted commit messages. Use when the user asks Codex or Claude Code to generate a commit message, commit staged changes, use aicommits/aic, create an AI commit, review staged Git changes for a commit, or install/use a Git AI commit workflow. Prefer the aicommits CLI when available and configured; fall back to direct staged-diff analysis when needed.
---

# Git AI Commit

Use this skill to generate a Git commit message from staged changes and, when explicitly authorized, create the commit.

## Core Rules

- Base commit messages on staged changes only unless the user explicitly asks you to stage files.
- Prefer the existing `aicommits` or `aic` CLI when it is installed and configured.
- Use `aicommits` for message generation only unless the user has already authorized a commit.
- Fall back to direct `git diff --cached` analysis when `aicommits` is unavailable, unconfigured, blocked by a non-interactive environment, rate-limited, or timed out.
- Show the proposed commit message before committing unless the user explicitly requested a non-interactive commit.
- Run `git commit` only when the user explicitly asks for a commit or approves the proposed message.
- Do not stage untracked files, bypass hooks, amend commits, reset, rebase, or force-push unless the user explicitly requests that separate operation.
- Leave unrelated unstaged changes alone.
- Never include secrets, API keys, tokens, passwords, or private values in commit messages.

## Workflow

1. Confirm the current directory is inside a Git repository:

   ```bash
   git rev-parse --show-toplevel
   ```

2. Inspect the working tree:

   ```bash
   git status --short
   ```

3. Check for staged changes:

   ```bash
   git diff --cached --name-only
   ```

4. If no staged changes exist:
   - If the user asked to commit all tracked changes, stage tracked updates with `git add --update`.
   - If the user named specific files, stage only those files.
   - If the user did not say what to stage, ask what should be staged before continuing.

5. Generate the message with `aicommits` when possible:
   - Check for `aicommits` first, then `aic`.
   - Pass user-requested options through, such as `--type conventional`, `--type subject+body`, `--prompt`, `--exclude`, or `--generate`.
   - In headless command execution, capture stdout from `aicommits`; this mode prints the generated message and does not commit.
   - In an interactive terminal, prefer `--clipboard` when you only need the generated message.
   - Do not pass `--yes` or run an interactive commit flow unless the user already authorized committing.

6. If CLI-backed generation fails for a recoverable reason, generate the message directly from:

   ```bash
   git diff --cached --diff-algorithm=minimal
   ```

7. Present the proposed message.

8. If committing is authorized, run `git commit` with the exact message. For multi-line messages, pass the subject and body with separate `-m` flags:

   ```bash
   git commit -m "subject" -m "body"
   ```

9. After a successful commit, show:
   - The new commit hash from `git rev-parse --short HEAD`.
   - The final commit message.

## CLI Preference Details

Before relying on `aicommits`, check whether either command exists:

```bash
command -v aicommits
command -v aic
```

If a command exists, use the repository's requested or inferred format. Examples:

```bash
aicommits --type conventional
aicommits --type subject+body
aicommits --prompt "Write the commit message in Chinese"
aicommits --exclude pnpm-lock.yaml
```

If the command reports missing configuration, do not run interactive setup unless the user asks for setup. Use fallback generation instead.

## Fallback Message Rules

When generating without `aicommits`:

- Use only staged diff content.
- Write in present tense.
- Describe what changed, not just which files changed.
- Prefer a concise subject under 72 characters unless the repository uses a different limit.
- Use Conventional Commits when requested or when recent commits clearly use it.
- Preserve the requested language.
- Use a body only when requested or when the changes need context that does not fit the subject.
- Avoid vague subjects such as `update files`, `fix changes`, `misc updates`, or `work in progress`.

Good fallback examples:

```text
feat: add staged diff chunking for large commits
```

```text
fix(config): tolerate missing provider settings in headless mode
```

```text
docs: document aicommits setup for custom endpoints
```

## Error Handling

- Not a Git repository: explain that the current directory must be a Git repository.
- No staged changes: ask what should be staged or suggest staging files.
- `aicommits` missing: continue with fallback generation and mention that installing `aicommits` enables CLI-backed generation.
- Provider configuration missing: use fallback generation unless the user specifically wants to configure `aicommits`.
- Timeout or rate limit: use fallback generation or ask whether to retry if the user specifically wanted CLI generation.
- Commit hook failure: report the hook failure and mention that `--no-verify` is available only if they want to bypass hooks.

## Claude Code Notes

For Claude Code-specific packaging and usage details, read `references/claude-code.md` only when the user asks about Claude Code installation or adaptation.
