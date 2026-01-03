# Fix Git Worktree and Bare Repository Hook Installation Bug

## Problem

The `aicommits hook install` and `aicommits hook uninstall` commands fail in git worktrees and bare repositories because they assume `.git` is always a directory.

### Root Cause

- **In git worktrees**: `.git` is a file (not a directory) containing a reference to the main repository's git directory:
  ```
  gitdir: /path/to/main/repo/.git/worktrees/<worktree-name>
  ```

- **In bare repos**: Hooks are in `./hooks/` not `./.git/hooks/`, and `git rev-parse --show-toplevel` fails

- **Current code**: Hardcodes `.git/hooks/` path at `src/commands/hook.ts:11` without handling these scenarios

## Research Summary

| Repo Type | `git rev-parse --git-path hooks` | `git rev-parse --show-toplevel` | Hooks Location |
|-----------|-----------------------------------|--------------------------------|----------------|
| **Regular** | `.git/hooks` (relative) | `/repo` | `/repo/.git/hooks/` |
| **Worktree** | `/main/.git/hooks` (absolute) | `/worktree` | `/main/.git/hooks/` (shared) |
| **Bare** | `hooks` (relative) | **FAILS** | `/bare-repo/hooks/` |
| **Subdirectory** | `../.git/hooks` (relative) | `/repo` | `/repo/.git/hooks/` |

### Key Findings

1. `git rev-parse --git-path hooks` handles all scenarios correctly - it returns the appropriate hooks directory path regardless of repo type
2. The returned path can be relative or absolute depending on repo type
3. Bare repos are broken in current code because `assertGitRepo()` calls `--show-toplevel` which fails in bare repos
4. Worktrees share hooks by default - installing in a worktree installs in the main repo's hooks directory (expected behavior)
5. The current hardcoded `.git/hooks/` path is wrong for worktrees and bare repos

## Solution

Use `git rev-parse --git-path hooks` to dynamically determine the correct hooks directory. This command:
- Returns the appropriate path for all repository types
- Returns absolute paths for worktrees (pointing to main repo)
- Returns relative paths for regular and bare repos
- Works correctly from any subdirectory

## Implementation Steps

### Step 1: Add Utilities to `src/utils/git.ts`

Add two new utility functions:

```typescript
export const getGitHooksPath = async () => {
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--git-path', 'hooks'],
		{ reject: false }
	);

	if (failed) {
		throw new KnownError('Failed to determine Git hooks directory');
	}

	return stdout;
};

export const getGitDir = async () => {
	// First try --show-toplevel (works for regular repos and worktrees)
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--show-toplevel'],
		{ reject: false }
	);

	if (!failed) {
		return stdout;
	}

	// Fallback to --git-dir (works for bare repos)
	const { stdout: gitDir, failed: gitDirFailed } = await execa(
		'git',
		['rev-parse', '--git-dir'],
		{ reject: false }
	);

	if (gitDirFailed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return gitDir;
};
```

### Step 2: Update `src/commands/hook.ts`

#### 2.1 Update imports

```typescript
import { getGitHooksPath, getGitDir } from '../utils/git.js';
```

#### 2.2 Remove hardcoded path and update detection

Remove line 11:
```typescript
// Remove: const symlinkPath = `.git/hooks/${hookName}`;
```

Update `isCalledFromGitHook` (lines 15-17):
```typescript
export const isCalledFromGitHook = () => {
	// Check if being called via git hook by examining the script path
	const scriptPath = process.argv[1].replace(/\\/g, '/');
	return scriptPath.endsWith(hookName) || scriptPath.includes('/hooks/');
};
```

#### 2.3 Update install/uninstall logic

Replace the path resolution logic (around line 36-40):

```typescript
export default command(
	{
		name: 'hook',
		description: 'Install or uninstall the Git hook for automatic commit messages',
		help: {
			description: 'Install or uninstall the Git hook for automatic commit messages',
		},
		parameters: ['<install/uninstall>'],
	},
	(argv) => {
		(async () => {
			const gitDir = await getGitDir();
			const hooksPath = await getGitHooksPath();
			const { installUninstall: mode } = argv._;

			// Resolve to absolute path
			let absoluteHookPath: string;
			if (path.isAbsolute(hooksPath)) {
				absoluteHookPath = hooksPath;
			} else {
				absoluteHookPath = path.resolve(gitDir, hooksPath);
			}
			
			const absoluteSymlinkPath = path.join(absoluteHookPath, hookName);
			const hookExists = await fileExists(absoluteSymlinkPath);

			if (mode === 'install') {
				if (hookExists) {
					// If the symlink is broken, it will throw an error
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					const realpath = await fs
						.realpath(absoluteSymlinkPath)
						.catch(() => {});
					if (realpath === hookPath) {
						console.warn('The hook is already installed');
						return;
					}
					throw new KnownError(
						`A different ${hookName} hook seems to be installed. Please remove it before installing aicommits.`
					);
				}

				await fs.mkdir(path.dirname(absoluteSymlinkPath), { recursive: true });

				if (isWindows) {
					await fs.writeFile(absoluteSymlinkPath, windowsHook);
				} else {
					await fs.symlink(hookPath, absoluteSymlinkPath, 'file');
					await fs.chmod(absoluteSymlinkPath, 0o755);
				}
				console.log(`${green('✔')} Hook installed`);
				return;
			}

			if (mode === 'uninstall') {
				if (!hookExists) {
					console.warn('Hook is not installed');
					return;
				}

				if (isWindows) {
					const scriptContent = await fs.readFile(absoluteSymlinkPath, 'utf8');
					if (scriptContent !== windowsHook) {
						console.warn('Hook is not installed');
						return;
					}
				} else {
					const realpath = await fs.realpath(absoluteSymlinkPath);
					if (realpath !== hookPath) {
						console.warn('Hook is not installed');
						return;
					}
				}

				await fs.rm(absoluteSymlinkPath);
				console.log(`${green('✔')} Hook uninstalled`);
				return;
			}

			throw new KnownError(`Invalid mode: ${mode}`);
		})().catch((error) => {
			console.error(`${red('✖')} ${error.message}`);
			handleCliError(error);
			process.exit(1);
		});
	}
);
```

### Step 3: Update Test References

**⚠️ CRITICAL:** This step is NOT optional - the existing test at line 44 will break after our changes.

#### 3.1 Fix Existing Test (BREAKING)

Update `tests/specs/git-hook.ts:44` - the hardcoded path check will fail for worktrees and bare repos:

```typescript
// CURRENT (line 44) - WILL BREAK:
expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

// REPLACED WITH:
// Import the utilities at top of file:
import { getGitHooksPath, getGitDir } from '../../src/utils/git.js';

// In the test (around line 42-44):
const { stdout } = await aicommits(['hook', 'install'], {
	cwd: path.join(fixture.path, 'some-dir'),
});
expect(stdout).toMatch('Hook installed');

// Use dynamic path detection instead of hardcoded path
const hooksPath = await getGitHooksPath();
const gitDir = await getGitDir();
const absoluteHookPath = path.isAbsolute(hooksPath) 
	? hooksPath 
	: path.resolve(gitDir, hooksPath);
const hookFilePath = path.join(absoluteHookPath, 'prepare-commit-msg');
expect(await fixture.exists(hookFilePath)).toBe(true);
```

#### 3.2 Add Uninstall Test

Add this test after the existing "installs from Git repo subdirectory" test:

```typescript
test('uninstalls hook', async () => {
	const { fixture, aicommits } = await createFixture(files);
	await createGit(fixture.path);

	// Install first
	await aicommits(['hook', 'install']);

	// Uninstall
	const { stdout } = await aicommits(['hook', 'uninstall']);
	expect(stdout).toMatch('Hook uninstalled');

	// Verify hook is removed
	const hooksPath = await getGitHooksPath();
	const gitDir = await getGitDir();
	const absoluteHookPath = path.isAbsolute(hooksPath) 
		? hooksPath 
		: path.resolve(gitDir, hooksPath);
	const hookFilePath = path.join(absoluteHookPath, 'prepare-commit-msg');
	expect(await fixture.exists(hookFilePath)).toBe(false);

	await fixture.rm();
});
```

#### 3.3 Add Worktree Install Test

Add this test after the uninstall test:

```typescript
test('installs hook in git worktree', async () => {
	const { fixture, aicommits } = await createFixture(files);
	const git = await createGit(fixture.path);

	// Create a worktree
	const worktreePath = path.join(fixture.path, 'wt1');
	await git('worktree', ['add', worktreePath]);

	// Install from worktree
	const { stdout } = await aicommits(['hook', 'install'], {
		cwd: worktreePath,
	});
	expect(stdout).toMatch('Hook installed');

	// Verify hook is in main repo (shared hooks)
	expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

	// Verify worktree's .git is a file (not a directory)
	const worktreeGitPath = path.join(worktreePath, '.git');
	const stats = await fs.stat(worktreeGitPath);
	expect(stats.isFile()).toBe(true);

	await fixture.rm();
});
```

#### 3.4 Add Worktree Uninstall Test

```typescript
test('uninstalls hook from git worktree', async () => {
	const { fixture, aicommits } = await createFixture(files);
	const git = await createGit(fixture.path);

	// Create a worktree and install hook
	const worktreePath = path.join(fixture.path, 'wt2');
	await git('worktree', ['add', worktreePath]);
	await aicommits(['hook', 'install'], { cwd: worktreePath });

	// Uninstall from worktree
	const { stdout } = await aicommits(['hook', 'uninstall'], {
		cwd: worktreePath,
	});
	expect(stdout).toMatch('Hook uninstalled');

	// Verify hook is removed from main repo
	expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(false);

	await fixture.rm();
});
```

#### 3.5 Add Bare Repository Test (Optional)

```typescript
test('installs hook in bare repository', async () => {
	const { fixture } = await createFixture(files);
	const git = await createGit(fixture.path);
	
	// Make initial commit
	await git('add', ['.']);
	await git('commit', ['-m', 'initial']);
	
	// Create bare repo
	const barePath = path.join(fixture.path, 'bare.git');
	await git('clone', ['--bare', fixture.path, barePath]);
	
	// Create aicommits with bare repo cwd
	const { aicommits: bareAicommits } = await createFixture();
	const { stdout } = await bareAicommits(['hook', 'install'], {
		cwd: barePath,
	});
	expect(stdout).toMatch('Hook installed');
	
	// Verify hook is in hooks/ directory (not .git/hooks/)
	expect(await fs.access(path.join(barePath, 'hooks', 'prepare-commit-msg')))
		.not.toThrow();
	
	await fixture.rm();
});
```

#### 3.6 Add Utility Function Tests (Optional)

Create new test file `tests/specs/git-utils.ts`:

```typescript
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../../utils.js';
import { getGitHooksPath, getGitDir } from '../../src/utils/git.js';
import files from '../../files.js';

export default testSuite(({ describe }) => {
	describe('Git utilities', ({ test }) => {
		test('getGitHooksPath returns correct path for regular repo', async () => {
			const { fixture } = await createFixture(files);
			await createGit(fixture.path);
			
			const hooksPath = await getGitHooksPath();
			expect(hooksPath).toBe('.git/hooks');
			
			await fixture.rm();
		});
		
		test('getGitHooksPath returns relative path from subdirectory', async () => {
			const { fixture } = await createFixture({
				...files,
				'subdir': { 'file.txt': '' }
			});
			const git = await createGit(fixture.path);
			await git('add', ['subdir/file.txt']);
			await git('commit', ['-m', 'test']);
			
			// Change to subdirectory and check path
			process.chdir(path.join(fixture.path, 'subdir'));
			const hooksPath = await getGitHooksPath();
			expect(hooksPath).toBe('../.git/hooks');
			process.chdir(fixture.path);
			
			await fixture.rm();
		});
		
		test('getGitHooksPath returns absolute path for worktree', async () => {
			const { fixture } = await createFixture(files);
			const git = await createGit(fixture.path);
			const worktreePath = path.join(fixture.path, 'wt-utils');
			await git('worktree', ['add', worktreePath]);
			
			// Check from worktree
			process.chdir(worktreePath);
			const hooksPath = await getGitHooksPath();
			expect(path.isAbsolute(hooksPath)).toBe(true);
			expect(hooksPath).toContain('.git/hooks');
			process.chdir(fixture.path);
			
			await fixture.rm();
		});
		
		test('getGitDir works for regular repos', async () => {
			const { fixture } = await createFixture(files);
			await createGit(fixture.path);
			
			const gitDir = await getGitDir();
			expect(gitDir).toBe(fixture.path);
			
			await fixture.rm();
		});
		
		test('getGitDir works from subdirectory', async () => {
			const { fixture } = await createFixture({
				...files,
				'subdir': { 'file.txt': '' }
			});
			await createGit(fixture.path);
			
			process.chdir(path.join(fixture.path, 'subdir'));
			const gitDir = await getGitDir();
			expect(gitDir).toBe(fixture.path);
			process.chdir(fixture.path);
			
			await fixture.rm();
		});
	});
});
```

#### 3.7 Register New Test File

Update `tests/index.ts` to include the new test file:

```typescript
import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli/index.js'));
	runTestSuite(import('./specs/openai/index.js'));
	runTestSuite(import('./specs/togetherai/index.js'));
	runTestSuite(import('./specs/config.js'));
	runTestSuite(import('./specs/git-hook.js'));
	runTestSuite(import('./specs/git-utils.js')); // Add this line
});
```

## Files to Modify

1. **`src/utils/git.ts`** - Add `getGitHooksPath()` and `getGitDir()` functions
2. **`src/commands/hook.ts`** - Update hook installation/uninstallation logic
3. **`tests/specs/git-hook.ts`** - Fix existing hardcoded path test, add worktree/uninstall tests
4. **`tests/index.ts`** - Register new git-utils test file (if created)
5. **`tests/specs/git-utils.ts`** - (Optional) New test file for utility functions

## Testing Strategy

### Test Priorities

| Priority | Test | Status | Impact |
|----------|------|--------|--------|
| 🔴 **Critical** | Fix `tests/specs/git-hook.ts:44` hardcoded path check | **BREAKING** | Existing test will fail after fix |
| 🔴 **Critical** | Worktree install test | Missing | Core feature of this fix |
| 🟡 **High** | Uninstall test | Missing | Basic functionality not tested |
| 🟡 **High** | Bare repo install test | Missing | Edge case coverage |
| 🟢 **Medium** | Worktree uninstall test | Missing | Edge case coverage |
| 🟢 **Medium** | Utility function tests | Missing | Unit test coverage |

### Manual Testing
- Create a git repo with worktrees
- Test install/uninstall from worktree
- Test install/uninstall from main repo
- Test from subdirectories
- Test with bare repository

### Automated Testing
- Add worktree tests to the test suite
- Verify all existing tests pass

### Cross-Platform
- Test on macOS, Linux, and Windows (including Windows-specific hook creation logic)

## Expected Behavior After Fix

| Scenario | Hook Location | Test Coverage |
|----------|---------------|---------------|
| Regular repo (root) | `.git/hooks/prepare-commit-msg` | Existing test (fixed) |
| Regular repo (subdir) | `.git/hooks/prepare-commit-msg` | Existing test (fixed) |
| Worktree install | `/main/.git/hooks/prepare-commit-msg` (shared) | **NEW TEST** |
| Worktree uninstall | Hook removed from main repo | **NEW TEST** |
| Bare repo | `./hooks/prepare-commit-msg` | **NEW TEST** |
| Uninstall (regular) | Hook removed from `.git/hooks/` | **NEW TEST** |

## Edge Cases Handled

1. **Relative vs absolute paths**: Code resolves relative paths to absolute
2. **Worktrees**: Uses git's default behavior (shared hooks)
3. **Bare repos**: Handles `--show-toplevel` failure and uses `--git-dir` fallback
4. **Subdirectories**: Git returns relative paths like `../.git/hooks` which resolve correctly
5. **Cross-platform**: Windows-specific hook creation logic remains unchanged

## Notes

- **Why two functions?**
  - `getGitHooksPath()`: Gets the hooks directory path (relative or absolute)
  - `getGitDir()`: Gets the git directory for path resolution (replaces `assertGitRepo()` for cases where we need the base directory)

- **isCalledFromGitHook update**: The current check compares against a hardcoded path. The updated version is more flexible and checks if the script is being called as a git hook by looking at the process.argv.

- **Backward compatibility**: All existing tests should pass, and hook installation behavior should remain the same for regular repos.

- **Test changes**: 
  - The test at `tests/specs/git-hook.ts:44` MUST be updated - it will break after the fix
  - Consider using the `getGitHooksPath()` utility in tests instead of hardcoded paths
  - Tests should verify the hook is installed where git expects it (not necessarily where the command was run)
