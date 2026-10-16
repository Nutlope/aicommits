import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../../package.json';

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_USER_AGENT = `aicommits/${pkg.version}`;

export type OpenCodeKey = {
	key: string;
	source: 'env' | 'opencode-auth-file';
	/** Which OpenCode provider entry the key came from. */
	entry?: 'opencode-go' | 'opencode';
};

const getOpenCodeAuthPath = () => {
	const dataHome =
		process.env.XDG_DATA_HOME ||
		path.join(os.homedir(), '.local', 'share');
	return path.join(dataHome, 'opencode', 'auth.json');
};

/**
 * Resolves an OpenCode API key without prompting: the `OPENCODE_API_KEY`
 * environment variable first, then the key the OpenCode CLI stored for the
 * `opencode-go` or `opencode` provider in its own auth file.
 */
export const resolveOpenCodeKey = (): OpenCodeKey | undefined => {
	const fromEnv = process.env.OPENCODE_API_KEY?.trim();
	if (fromEnv) return { key: fromEnv, source: 'env' };

	let raw: string;
	try {
		raw = fs.readFileSync(getOpenCodeAuthPath(), 'utf8');
	} catch {
		return;
	}
	let parsed: Record<string, { type?: string; key?: string } | undefined>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	for (const entry of ['opencode-go', 'opencode'] as const) {
		const info = parsed[entry];
		if (info?.type === 'api' && typeof info.key === 'string' && info.key) {
			return { key: info.key, source: 'opencode-auth-file', entry };
		}
	}
};

export type OpenCodeEntitlement = 'go' | 'zen-only' | 'invalid' | 'unknown';

/**
 * `GET /zen/go/v1/usage` answers 200 for an active Go or Go Plus plan, 403
 * for a Zen-only key and 401 for an invalid key.
 */
export const checkOpenCodeGoEntitlement = async (
	key: string,
	timeoutMs = 5_000
): Promise<OpenCodeEntitlement> => {
	try {
		const response = await fetch(`${OPENCODE_GO_BASE_URL}/usage`, {
			headers: {
				Authorization: `Bearer ${key}`,
				'User-Agent': OPENCODE_USER_AGENT,
			},
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (response.status === 200) return 'go';
		if (response.status === 403) return 'zen-only';
		if (response.status === 401) return 'invalid';
		return 'unknown';
	} catch {
		return 'unknown';
	}
};
