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
