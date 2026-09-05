import { KnownError } from './error.js';
import type { JSONValue } from 'ai';

const commitTypes = [
	'plain',
	'conventional',
	'conventional+body',
	'gitmoji',
	'subject+body',
] as const;

export type CommitType = (typeof commitTypes)[number];

type CommitFormat = 'plain' | 'conventional' | 'gitmoji';

const commitTypePolicies: Record<
	CommitType,
	{ format: CommitFormat; requiresBody: boolean }
> = {
	plain: { format: 'plain', requiresBody: false },
	conventional: { format: 'conventional', requiresBody: false },
	'conventional+body': { format: 'conventional', requiresBody: true },
	gitmoji: { format: 'gitmoji', requiresBody: false },
	'subject+body': { format: 'plain', requiresBody: true },
};

export const getCommitTypePolicy = (type: CommitType) =>
	commitTypePolicies[type];

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) =>
	hasOwnProperty.call(object, key);

const parseAssert = (name: string, condition: boolean, message: string) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

export type ProviderOptions = Record<string, Record<string, JSONValue>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JSONValue => {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	return isRecord(value) && Object.values(value).every(isJsonValue);
};

const parseProviderOptions = (value?: unknown): ProviderOptions => {
	if (value === undefined || value === '') {
		return {};
	}

	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new KnownError(
				'Invalid config property PROVIDER_OPTIONS: Must be valid JSON.'
			);
		}
	}

	parseAssert(
		'PROVIDER_OPTIONS',
		isRecord(parsed),
		'Must be an object keyed by provider name.'
	);
	const parsedOptions = parsed as Record<string, unknown>;

	for (const [providerName, options] of Object.entries(parsedOptions)) {
		parseAssert(
			'PROVIDER_OPTIONS',
			isRecord(options),
			`Provider "${providerName}" options must be an object.`
		);
		parseAssert(
			'PROVIDER_OPTIONS',
			isJsonValue(options),
			`Provider "${providerName}" options must contain JSON values.`
		);
	}

	return parsedOptions as ProviderOptions;
};

const configParsers = {
	OPENAI_API_KEY(key?: string) {
		return key;
	},
	OPENAI_BASE_URL(key?: string) {
		return key;
	},
	OPENAI_MODEL(key?: string) {
		return key || '';
	},
	PROVIDER_OPTIONS(value?: unknown) {
		return parseProviderOptions(value);
	},
	locale(locale?: string) {
		if (!locale) {
			return 'en';
		}
		parseAssert('locale', !!locale, 'Cannot be empty');
		parseAssert(
			'locale',
			/^[a-z-]+$/i.test(locale),
			'Must be a valid locale (letters and dashes/underscores).'
		);
		return locale;
	},
	generate(count?: string) {
		if (!count) {
			return 1;
		}
		parseAssert('generate', /^\d+$/.test(count), 'Must be an integer');
		const parsed = Number(count);
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');
		return parsed;
	},
	type(type?: string) {
		if (!type) {
			return 'plain';
		}
		parseAssert(
			'type',
			commitTypes.includes(type as CommitType),
			'Invalid commit type'
		);
		return type as CommitType;
	},
	proxy(url?: string) {
		if (!url || url.length === 0) {
			return undefined;
		}
		throw new KnownError(
			'The "proxy" config property is deprecated and no longer supported.'
		);
	},
	timeout(timeout?: string) {
		if (!timeout) {
			return undefined;
		}

		parseAssert('timeout', /^\d+$/.test(timeout), 'Must be an integer');

		const parsed = Number(timeout);
		parseAssert('timeout', parsed >= 500, 'Must be greater than 500ms');

		return parsed;
	},
	'max-length'(maxLength?: string) {
		if (!maxLength) {
			return 72;
		}
		parseAssert('max-length', /^\d+$/.test(maxLength), 'Must be an integer');
		const parsed = Number(maxLength);
		parseAssert(
			'max-length',
			parsed >= 20,
			'Must be greater than 20 characters'
		);
		return parsed;
	},
} as const;

type ConfigKeys = keyof typeof configParsers;

type RawConfig = {
	[key in ConfigKeys]?: unknown;
};

export type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<(typeof configParsers)[Key]>;
} & {
	OPENAI_API_KEY: string | undefined;
	OPENAI_BASE_URL: string | undefined;
	OPENAI_MODEL: string;
	model: string;
	provider: string | undefined;
	timeout: number | undefined;
};

export { configParsers, type ConfigKeys, type RawConfig };
