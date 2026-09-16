# Git AI Commit Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally install a reusable `git-ai-commit` skill that helps Codex and Claude Code generate and optionally create AI-assisted Git commits.

**Architecture:** Keep the repository copy at `skills/git-ai-commit` as the source of truth, then copy it to `~/.codex/skills/git-ai-commit` for local Codex discovery. The skill is instruction-driven: it prefers the existing `aicommits` CLI, then falls back to direct staged-diff analysis when the CLI is unavailable or blocked.

**Tech Stack:** Codex skill format, Markdown, YAML metadata, Git CLI, existing `aicommits` CLI.

---

## File Structure

- Create `skills/git-ai-commit/SKILL.md`: main cross-agent workflow, trigger frontmatter, safety rules, fallback generation rules, and verification behavior.
- Create `skills/git-ai-commit/agents/openai.yaml`: Codex UI metadata for the skill.
- Create `skills/git-ai-commit/references/claude-code.md`: Claude Code-specific usage notes and installation guidance.
- Copy `skills/git-ai-commit` to `~/.codex/skills/git-ai-commit`: local install target for immediate Codex discovery.

### Task 1: Create Repository Skill Source

**Files:**
- Create: `skills/git-ai-commit/SKILL.md`
- Create: `skills/git-ai-commit/references/claude-code.md`

- [ ] **Step 1: Create the skill directories**

Run:

```bash
mkdir -p skills/git-ai-commit/references
```

Expected: command exits with status 0.

- [ ] **Step 2: Write `SKILL.md`**

Create `skills/git-ai-commit/SKILL.md` with:

```markdown
---
name: git-ai-commit
description: Generate and optionally create Git commits with AI-assisted commit messages. Use when the user asks Codex or Claude Code to generate a commit message, commit staged changes, use aicommits/aic, create an AI commit, review staged Git changes for a commit, or install/use a Git AI commit workflow. Prefer the aicommits CLI when available and configured; fall back to direct staged-diff analysis when needed.
---

# Git AI Commit

Use this skill to generate a Git commit message from staged changes and, when explicitly authorized, create the commit.

## Core Rules

- Base commit messages on staged changes only unless the user explicitly asks you to stage files.
- Prefer the existing `aicommits` or `aic` CLI when it is installed and configured.
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
   - Use `aicommits` first, or `aic` if only the alias is available.
   - Pass user-requested options through, such as `--type conventional`, `--type subject+body`, `--prompt`, `--exclude`, `--generate`, `--yes`, or `--no-verify`.
   - Prefer capturing stdout in headless environments.
   - Use `--clipboard` only when an interactive terminal and clipboard are useful.

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

If a command exists, prefer:

```bash
aicommits --type conventional
```

Adjust flags to match the user request and repository convention. Examples:

```bash
aicommits --type conventional --clipboard
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
```

- [ ] **Step 3: Write Claude Code reference**

Create `skills/git-ai-commit/references/claude-code.md` with:

```markdown
# Claude Code Notes

Use the same workflow from `SKILL.md` in Claude Code. The important adaptation is tool naming and installation location, not commit behavior.

## Usage

Trigger this skill for requests such as:

- "Use AI to write a commit message."
- "Commit the staged changes."
- "Use aicommits to commit this."
- "Generate a conventional commit for these staged changes."

## Installation Shape

For Claude Code, keep the skill folder contents intact:

```text
git-ai-commit/
  SKILL.md
  references/
    claude-code.md
```

If a Claude Code environment supports project-level skills, place the folder in that environment's skill discovery path. If it does not, copy the `SKILL.md` workflow into the relevant project instructions.

## Behavior Notes

- Prefer the `aicommits` CLI when available.
- Fall back to direct staged-diff analysis when the CLI is missing or cannot run.
- Do not commit without explicit user authorization.
- Do not stage untracked files unless explicitly requested.
- Keep generated commit messages based on `git diff --cached`.
```

- [ ] **Step 4: Review the files**

Run:

```bash
sed -n '1,260p' skills/git-ai-commit/SKILL.md
sed -n '1,220p' skills/git-ai-commit/references/claude-code.md
```

Expected: frontmatter contains only `name` and `description`; no placeholders are present.

### Task 2: Add Codex Metadata

**Files:**
- Create: `skills/git-ai-commit/agents/openai.yaml`

- [ ] **Step 1: Read metadata guidance**

Run:

```bash
sed -n '1,220p' /Users/hanly/.codex/skills/.system/skill-creator/references/openai_yaml.md
```

Expected: output describes `display_name`, `short_description`, and `default_prompt`.

- [ ] **Step 2: Create metadata directory**

Run:

```bash
mkdir -p skills/git-ai-commit/agents
```

Expected: command exits with status 0.

- [ ] **Step 3: Write `openai.yaml`**

Create `skills/git-ai-commit/agents/openai.yaml` with deterministic metadata matching `SKILL.md`:

```yaml
display_name: Git AI Commit
short_description: Generate Git commit messages from staged changes.
default_prompt: Generate an AI-assisted Git commit message for the staged changes, then ask before committing unless I explicitly authorize the commit.
```

- [ ] **Step 4: Review metadata**

Run:

```bash
sed -n '1,120p' skills/git-ai-commit/agents/openai.yaml
```

Expected: YAML has exactly the three intended interface fields.

### Task 3: Install Local Codex Copy

**Files:**
- Copy: `skills/git-ai-commit/` to `/Users/hanly/.codex/skills/git-ai-commit/`

- [ ] **Step 1: Remove stale local copy if present**

Run:

```bash
rm -rf /Users/hanly/.codex/skills/git-ai-commit
```

Expected: command exits with status 0. This removes only the generated local install copy.

- [ ] **Step 2: Copy repository skill to Codex skills**

Run:

```bash
cp -R skills/git-ai-commit /Users/hanly/.codex/skills/git-ai-commit
```

Expected: command exits with status 0.

- [ ] **Step 3: Compare source and installed copy**

Run:

```bash
diff -ru skills/git-ai-commit /Users/hanly/.codex/skills/git-ai-commit
```

Expected: no output and exit status 0.

### Task 4: Validate And Commit Skill

**Files:**
- Validate: `skills/git-ai-commit/SKILL.md`
- Validate: `skills/git-ai-commit/agents/openai.yaml`
- Validate: `/Users/hanly/.codex/skills/git-ai-commit`

- [ ] **Step 1: Locate validation script**

Run:

```bash
find /Users/hanly/.codex/skills/.system/skill-creator -name quick_validate.py -print
```

Expected: output includes the path to `quick_validate.py`.

- [ ] **Step 2: Validate repository skill**

Run:

```bash
/Users/hanly/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/git-ai-commit
```

Expected: validation passes.

- [ ] **Step 3: Validate installed skill**

Run:

```bash
/Users/hanly/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hanly/.codex/skills/git-ai-commit
```

Expected: validation passes.

- [ ] **Step 4: Check repository status**

Run:

```bash
git status --short
```

Expected: only intended skill files and the plan file are modified or untracked.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add skills/git-ai-commit docs/superpowers/plans/2026-06-25-git-ai-commit-skill.md
git commit -m "feat: add git ai commit skill"
```

Expected: commit succeeds.
