import { confirm, isCancel, log, select, spinner } from '@clack/prompts';
import { dim, green, yellow } from 'kolorist';
import { providers } from '../providers/providers-data.js';
import type { ProviderDef } from '../providers/base.js';
import type { ValidConfig } from '../../utils/config-types.js';
import { KnownError } from '../../utils/error.js';
import {
	detectSubscriptions,
	type SubscriptionId,
	type SubscriptionStatus,
} from './detect.js';
import { installHint, loginCommand, runLogin } from './login.js';
import { resolveOpenCodeKey, type OpenCodeKey } from './opencode.js';

export type DetectionReport = {
	statuses: Record<SubscriptionId, SubscriptionStatus>;
	openCodeKey?: OpenCodeKey;
};

export const detectAll = async (
	config: Pick<ValidConfig, 'claude-path' | 'codex-path'>
): Promise<DetectionReport> => {
	const [claude, codex] = await detectSubscriptions({
		claudeBinary: config['claude-path'],
		codexBinary: config['codex-path'],
	});
	return {
		statuses: { claude, codex },
		openCodeKey: resolveOpenCodeKey(),
	};
};

export const detectWithSpinner = async (
	config: Pick<ValidConfig, 'claude-path' | 'codex-path'>
) => {
	const s = spinner();
	s.start('Looking for subscriptions on this machine');
	const report = await detectAll(config);
	const found = activeProviderNames(report);
	s.stop(
		found.length > 0
			? `Found ${found.length} subscription${found.length === 1 ? '' : 's'}: ${found
					.map((name) => providerLabel(name, report))
					.join(', ')}`
			: 'No active subscriptions found'
	);
	return report;
};

export const activeProviderNames = (report: DetectionReport): string[] =>
	providers
		.filter((provider) => isActive(provider, report))
		.map((provider) => provider.name);

export const isActive = (provider: ProviderDef, report: DetectionReport) => {
	if (provider.subscription === 'opencode') return Boolean(report.openCodeKey);
	if (provider.subscription) return report.statuses[provider.subscription].active;
	return false;
};

const capitalize = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

export const providerLabel = (name: string, report: DetectionReport) => {
	const provider = providers.find((candidate) => candidate.name === name);
	if (!provider) return name;
	if (provider.subscription && provider.subscription !== 'opencode') {
		const plan = report.statuses[provider.subscription].plan;
		return plan ? `${provider.displayName} · ${capitalize(plan)} plan` : provider.displayName;
	}
	return provider.displayName;
};

/** Options for the provider picker: detected subscriptions first, with status hints. */
export const buildProviderOptions = (
	report: DetectionReport,
	current?: string
) => {
	const detected: { value: string; label: string; hint?: string }[] = [];
	const rest: { value: string; label: string; hint?: string }[] = [];
	for (const provider of providers) {
		const option = {
			value: provider.name,
			label: provider.displayName,
			hint: provider.hint,
		};
		if (!provider.subscription) {
			rest.push(option);
			continue;
		}
		if (isActive(provider, report)) {
			detected.push({
				...option,
				label: `${providerLabel(provider.name, report)} ${green('● detected')}`,
			});
			continue;
		}
		if (provider.subscription === 'opencode') {
			rest.push({ ...option, hint: 'needs an OpenCode Go API key' });
			continue;
		}
		const status = report.statuses[provider.subscription];
		rest.push({
			...option,
			label: `${provider.displayName} ${dim(
				status.installed ? '○ not logged in' : '○ not installed'
			)}`,
			hint: status.installed
				? `we can run \`${loginCommand(provider.subscription, status.binary)}\` for you`
				: installHint[provider.subscription],
		});
	}
	const options = [...detected, ...rest];
	if (current) {
		const index = options.findIndex((option) => option.value === current);
		if (index > 0) options.unshift(...options.splice(index, 1));
	}
	return options;
};

/**
 * Makes sure an agent-SDK provider is usable: the CLI is installed and logged
 * in, offering to run the vendor's login flow when it is not.
 */
export const ensureSubscription = async (
	provider: ProviderDef,
	report: DetectionReport,
	config: Pick<ValidConfig, 'claude-path' | 'codex-path'>
): Promise<boolean> => {
	const id = provider.subscription;
	if (!id || id === 'opencode') return true;
	let status = report.statuses[id];
	if (!status.installed) {
		throw new KnownError(
			`${provider.displayName} needs the ${id} CLI on your PATH. ${installHint[id]}`
		);
	}
	if (status.active) return true;

	const shouldLogin = await confirm({
		message: `${provider.displayName} is not logged in. Run \`${loginCommand(
			id,
			status.binary
		)}\` now?`,
	});
	if (isCancel(shouldLogin) || !shouldLogin) return false;

	log.info(dim('Handing over to the vendor login. aicommits never sees your credentials.'));
	await runLogin(id, status.binary);
	const refreshed = await detectAll(config);
	status = refreshed.statuses[id];
	report.statuses[id] = status;
	if (!status.active) {
		log.warn(
			yellow(
				status.method && status.method !== 'none'
					? `${provider.displayName} is logged in with ${status.method}, not a subscription. Log in with your plan account to use it.`
					: 'Login did not complete.'
			)
		);
		return false;
	}
	log.success(`Logged in to ${providerLabel(provider.name, report)}`);
	return true;
};

/**
 * First-run helper: when no provider is configured, offer detected
 * subscriptions. Returns the chosen provider name, or null to fall back to
 * `aicommits setup`.
 */
export const offerDetectedSubscription = async (
	config: Pick<ValidConfig, 'claude-path' | 'codex-path'>
): Promise<string | null> => {
	const report = await detectWithSpinner(config);
	const active = activeProviderNames(report);
	if (active.length === 0) return null;

	const choice = await select({
		message: 'Use one of your subscriptions for commit messages?',
		options: [
			...active.map((name) => ({
				value: name,
				label: providerLabel(name, report),
				hint: providers.find((provider) => provider.name === name)?.hint,
			})),
			{ value: '', label: 'Something else', hint: 'opens aicommits setup' },
		],
	});
	if (isCancel(choice) || !choice) return null;
	return choice as string;
};
