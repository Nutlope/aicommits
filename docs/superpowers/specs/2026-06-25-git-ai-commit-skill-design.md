# Git AI Commit Skill Design

## Goal

Create a reusable `git-ai-commit` skill based on this `aicommits` project. The skill should help Codex and Claude Code generate and optionally create Git commits with AI-assisted commit messages.

The skill should prefer the `aicommits` CLI when it is available and configured, then fall back to direct model-based commit message generation from `git diff --cached` when the CLI cannot be used.

## Users And Triggers

The skill should trigger when a user asks an agent to:

- Generate an AI commit message.
- Commit staged changes.
- Use `aicommits`, `aic`, or AI commit tooling.
- Review staged Git changes and write a commit.

The initial implementation targets Codex first, while keeping the workflow and references usable for Claude Code.

## Placement

Keep a source copy in this repository:

```text
skills/git-ai-commit/
```

Install a copy for local Codex discovery:

```text
~/.codex/skills/git-ai-commit/
```

The repository copy is the editable source of truth. The local Codex copy should match it after implementation.

## Skill Structure

```text
skills/
  git-ai-commit/
    SKILL.md
    agents/
      openai.yaml
    references/
      claude-code.md
```

`SKILL.md` contains the core cross-agent workflow.

`agents/openai.yaml` contains Codex UI metadata generated from the skill.

`references/claude-code.md` documents Claude Code-specific usage notes without duplicating the main workflow.

No scripts are required for the first version. The skill delegates deterministic behavior to the existing `aicommits` CLI and uses normal Git commands for fallback.

## Workflow

1. Confirm the current directory is inside a Git repository with `git rev-parse --show-toplevel`.
2. Inspect current changes with `git status --short`.
3. Determine whether staged changes exist with `git diff --cached --name-only`.
4. If no staged changes exist:
   - If the user explicitly asked to stage tracked changes or commit all relevant work, stage only the requested files or tracked updates.
   - Otherwise, ask the user what should be staged.
5. Generate the commit message:
   - Prefer `aicommits` or `aic` when available.
   - Use `aicommits --clipboard` in interactive environments when copying is useful.
   - Use headless command execution when stdout capture is needed.
   - Pass format flags such as `--type conventional`, `--type subject+body`, `--prompt`, `--exclude`, `--no-verify`, or `--generate` when requested by the user.
6. If `aicommits` is missing, unconfigured, non-interactive in a way that blocks setup, or fails for a recoverable reason, fall back to reading `git diff --cached` and generating a commit message directly.
7. Before committing, show the proposed commit message unless the user explicitly requested a non-interactive commit.
8. Run `git commit` only when the user explicitly asks the agent to commit or has already authorized committing.
9. After committing, show the resulting commit hash and final commit message.

## Fallback Message Rules

When the agent generates the commit message without `aicommits`, it should:

- Base the message only on staged changes.
- Prefer present tense.
- Be specific about behavior or files changed.
- Avoid vague messages such as `update files` or `fix changes`.
- Preserve the user's requested format and language.
- Use Conventional Commits when requested or when the repository clearly follows that pattern.
- Use a body only when requested or when the staged changes need more context.

## Safety Rules

The skill should avoid surprising repository mutations:

- Do not stage untracked files unless the user explicitly requests them.
- Do not run `git commit` unless the user explicitly asks for a commit or gives approval after seeing the message.
- Do not bypass hooks with `--no-verify` unless requested.
- Do not amend, reset, rebase, or force-push as part of this skill.
- Do not include secrets or sensitive values in commit messages.
- If the working tree has unrelated unstaged changes, leave them alone.

## Error Handling

The skill should handle these common cases:

- Not in a Git repository: explain that the current directory must be a Git repository.
- No staged changes: ask what should be staged or suggest staging files.
- `aicommits` missing: use fallback generation and mention that installing `aicommits` enables CLI-backed generation.
- Provider configuration missing: use fallback generation unless the user specifically wants to configure `aicommits`.
- Provider timeout or rate limit: use fallback generation or ask whether to retry.
- Commit hook failure: report the hook failure and mention `--no-verify` only as an explicit follow-up option.

## Validation

Implementation is complete when:

- The repository skill exists at `skills/git-ai-commit`.
- The local Codex copy exists at `~/.codex/skills/git-ai-commit`.
- `SKILL.md` has valid frontmatter with only `name` and `description`.
- `agents/openai.yaml` matches the skill.
- `references/claude-code.md` exists and does not duplicate the full skill body.
- The skill passes `quick_validate.py`.
- The copied local skill matches the repository source.

## Out Of Scope

- Publishing to a marketplace.
- Creating a Claude Code plugin package.
- Changing the `aicommits` CLI implementation.
- Adding new commit-generation features to `aicommits`.
- Automatically installing Node packages or global CLIs.
