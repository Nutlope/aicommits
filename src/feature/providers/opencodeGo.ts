import pkg from '../../../package.json';
import type { ProviderDef } from './base.js';

export const OpenCodeGoProvider: ProviderDef = {
	name: 'opencode-go',
	displayName: 'OpenCode Go',
	baseUrl: 'https://opencode.ai/zen/go/v1',
	defaultModels: ['deepseek-v4-flash'],
	requiresApiKey: true,
	headers: {
		'User-Agent': `aicommits/${pkg.version}`,
	},
	sessionHeader: 'x-opencode-session',
};
