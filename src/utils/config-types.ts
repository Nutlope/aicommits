import { KnownError } from './error.js';

const commitTypes = ['plain', 'conventional', 'gitmoji', 'subject+body'] as const;

export type CommitType = (typeof commitTypes)[number];

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) =>
	hasOwnProperty.call(object, key);

const parseAssert = (name: string, condition: boolean, message: string) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
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
	[key in ConfigKeys]?: string;
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
