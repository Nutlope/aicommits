import { execa } from 'execa';
import type { SubscriptionId } from './detect.js';

const loginArgs: Record<SubscriptionId, string[]> = {
	claude: ['auth', 'login'],
	codex: ['login'],
};

export const loginCommand = (id: SubscriptionId, binary?: string) =>
	`${binary ?? id} ${loginArgs[id].join(' ')}`;

export const installHint: Record<SubscriptionId, string> = {
	claude: 'Install Claude Code: https://claude.com/product/claude-code',
	codex: 'Install Codex: npm i -g @openai/codex',
};

/**
 * Runs the vendor's own interactive login in the user's terminal. aicommits
 * never sees the credentials; the CLI stores them itself.
 */
export const runLogin = async (id: SubscriptionId, binary?: string) => {
	const { exitCode } = await execa(binary ?? id, loginArgs[id], {
		stdio: 'inherit',
		reject: false,
	});
	return exitCode === 0;
};
