import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 3_000;

export type SubscriptionId = 'claude' | 'codex';

export type SubscriptionStatus = {
	id: SubscriptionId;
	/** The CLI binary is installed and runnable. */
	installed: boolean;
	/** The CLI reports a subscription login (not an API key). */
	active: boolean;
	/** Human-readable plan label when the CLI exposes one. */
	plan?: string;
	/** Login method reported by the CLI, kept for diagnostics. */
	method?: string;
	/** Reported CLI version. */
	version?: string;
	/** Resolved binary path or command name. */
	binary: string;
};

type ExecResult =
	| { stdout: string; stderr: string; exitCode: number }
	| { error: 'missing' | 'failed' };

const run = async (binary: string, args: string[]): Promise<ExecResult> => {
	try {
		const { stdout, stderr } = await execFileAsync(binary, args, {
			timeout: PROBE_TIMEOUT_MS,
			encoding: 'utf8',
			env: { ...process.env, NO_COLOR: '1' },
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & {
			stdout?: string;
			stderr?: string;
			code?: string | number;
			killed?: boolean;
		};
		if (failure.code === 'ENOENT') return { error: 'missing' };
		if (failure.killed) return { error: 'failed' };
		if (typeof failure.code === 'number') {
			return {
				stdout: failure.stdout ?? '',
				stderr: failure.stderr ?? '',
				exitCode: failure.code,
			};
		}
		return { error: 'failed' };
	}
};

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';

type ClaudeAuthStatus = {
	loggedIn?: boolean;
	authMethod?: string;
	subscriptionType?: string | null;
};

/**
 * `claude auth status` prints JSON by default and exits 1 when logged out.
 * A subscription login shows `authMethod: 'claude.ai'` (browser login) or
 * `'oauth_token'` (a long-lived token from `claude setup-token`).
 */
export const detectClaude = async (
	binary = 'claude'
): Promise<SubscriptionStatus> => {
	const base: SubscriptionStatus = {
		id: 'claude',
		installed: false,
		active: false,
		binary,
	};
	const status = await run(binary, ['auth', 'status']);
	if ('error' in status) return base;
	base.installed = true;

	const version = await run(binary, ['--version']);
	if (!('error' in version)) {
		base.version = firstLine(version.stdout).replace(
			/\s*\(Claude Code\)\s*$/,
			''
		);
	}

	let parsed: ClaudeAuthStatus;
	try {
		parsed = JSON.parse(status.stdout) as ClaudeAuthStatus;
	} catch {
		return base;
	}
	base.method = parsed.authMethod;
	base.active =
		parsed.loggedIn === true &&
		(parsed.authMethod === 'claude.ai' ||
			parsed.authMethod === 'oauth_token');
	if (base.active && parsed.subscriptionType) {
		base.plan = parsed.subscriptionType;
	}
	return base;
};

/**
 * `codex login status` exits 0 when logged in and prints the method on one
 * line, for example "Logged in using ChatGPT" or
 * "Logged in using an API key - sk-...". It exits 1 with "Not logged in".
 */
export const detectCodex = async (
	binary = 'codex'
): Promise<SubscriptionStatus> => {
	const base: SubscriptionStatus = {
		id: 'codex',
		installed: false,
		active: false,
		binary,
	};
	const status = await run(binary, ['login', 'status']);
	if ('error' in status) return base;
	base.installed = true;

	const version = await run(binary, ['--version']);
	if (!('error' in version)) {
		base.version = firstLine(version.stdout).replace(/^codex-cli\s+/, '');
	}

	if (status.exitCode !== 0) {
		base.method = 'none';
		return base;
	}
	// Codex prints the login status to stderr; older builds used stdout.
	const line = firstLine(status.stdout) || firstLine(status.stderr);
	if (/logged in using chatgpt/i.test(line)) {
		base.method = 'chatgpt';
		base.active = true;
		base.plan = 'ChatGPT';
	} else if (/api key/i.test(line)) {
		base.method = 'api-key';
	} else {
		base.method = 'other';
	}
	return base;
};

export const detectSubscriptions = async (options?: {
	claudeBinary?: string;
	codexBinary?: string;
}) =>
	Promise.all([
		detectClaude(options?.claudeBinary),
		detectCodex(options?.codexBinary),
	]);
