import type { CommitType } from './config-types.js';

export const commitTypeFormats: Record<CommitType, string> = {
	plain: '<commit message>',
	conventional: '<type>[optional (<scope>)]: <commit message>\nThe commit message subject must start with a lowercase letter',
	gitmoji: ':emoji: <commit message>',
	'subject+body': '<commit message subject>',
};
const specifyCommitFormat = (type: CommitType) =>
	`The output response must be in format:\n${commitTypeFormats[type]}`;

const commitTypes: Record<CommitType, string> = {
	plain: '',

	/**
	 * References:
	 * Commitlint:
	 * https://github.com/conventional-changelog/commitlint/blob/18fbed7ea86ac0ec9d5449b4979b762ec4305a92/%40commitlint/config-conventional/index.js#L40-L100
	 *
	 * Conventional Changelog:
	 * https://github.com/conventional-changelog/conventional-changelog/blob/d0e5d5926c8addba74bc962553dd8bcfba90e228/packages/conventional-changelog-conventionalcommits/writer-opts.js#L182-L193
	 */
	conventional: `Choose a type from the type-to-description JSON below that best describes the git diff. IMPORTANT: The type MUST be lowercase (e.g., "feat", not "Feat" or "FEAT"):\n${JSON.stringify(
		{
			docs: 'Documentation only changes',
			style:
				'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
			refactor: 'A code change that improves code structure without changing functionality (renaming, restructuring classes/methods, extracting functions, etc)',
			perf: 'A code change that improves performance',
			test: 'Adding missing tests or correcting existing tests',
			build: 'Changes that affect the build system or external dependencies',
			ci: 'Changes to our CI configuration files and scripts',
			chore: "Other changes that don't modify src or test files",
			revert: 'Reverts a previous commit',
			feat: 'A new feature',
			fix: 'A bug fix',
		},
		null,
		2
	)}`,

	/**
	 * References:
	 * Gitmoji: https://gitmoji.dev/
	 */
	gitmoji: `Choose an emoji from the emoji-to-description JSON below that best describes the git diff:\n${JSON.stringify(
		{
			'🎨': 'Improve structure / format of the code',
			'⚡': 'Improve performance',
			'🔥': 'Remove code or files',
			'🐛': 'Fix a bug',
			'🚑': 'Critical hotfix',
			'✨': 'Introduce new features',
			'📝': 'Add or update documentation',
			'🚀': 'Deploy stuff',
			'💄': 'Add or update the UI and style files',
			'🎉': 'Begin a project',
			'✅': 'Add, update, or pass tests',
			'🔒': 'Fix security or privacy issues',
			'🔐': 'Add or update secrets',
			'🔖': 'Release / Version tags',
			'🚨': 'Fix compiler / linter warnings',
			'🚧': 'Work in progress',
			'💚': 'Fix CI Build',
			'⬇️': 'Downgrade dependencies',
			'⬆️': 'Upgrade dependencies',
			'📌': 'Pin dependencies to specific versions',
			'👷': 'Add or update CI build system',
			'📈': 'Add or update analytics or track code',
			'♻️': 'Refactor code',
			'➕': 'Add a dependency',
			'➖': 'Remove a dependency',
			'🔧': 'Add or update configuration files',
			'🔨': 'Add or update development scripts',
			'🌐': 'Internationalization and localization',
			'✏️': 'Fix typos',
			'💩': 'Write bad code that needs to be improved',
			'⏪': 'Revert changes',
			'🔀': 'Merge branches',
			'📦': 'Add or update compiled files or packages',
			'👽': 'Update code due to external API changes',
			'🚚': 'Move or rename resources (e.g.: files, paths, routes)',
			'📄': 'Add or update license',
			'💥': 'Introduce breaking changes',
			'🍱': 'Add or update assets',
			'♿': 'Improve accessibility',
			'💡': 'Add or update comments in source code',
			'🍻': 'Write code drunkenly',
			'💬': 'Add or update text and literals',
			'🗃': 'Perform database related changes',
			'🔊': 'Add or update logs',
			'🔇': 'Remove logs',
			'👥': 'Add or update contributor(s)',
			'🚸': 'Improve user experience / usability',
			'🏗': 'Make architectural changes',
			'📱': 'Work on responsive design',
			'🤡': 'Mock things',
			'🥚': 'Add or update an easter egg',
			'🙈': 'Add or update a .gitignore file',
			'📸': 'Add or update snapshots',
			'⚗': 'Perform experiments',
			'🔍': 'Improve SEO',
			'🏷': 'Add or update types',
			'🌱': 'Add or update seed files',
			'🚩': 'Add, update, or remove feature flags',
			'🥅': 'Catch errors',
			'💫': 'Add or update animations and transitions',
			'🗑': 'Deprecate code that needs to be cleaned up',
			'🛂': 'Work on code related to authorization, roles and permissions',
			'🩹': 'Simple fix for a non-critical issue',
			'🧐': 'Data exploration/inspection',
			'⚰': 'Remove dead code',
			'🧪': 'Add a failing test',
			'👔': 'Add or update business logic',
			'🩺': 'Add or update healthcheck',
			'🧱': 'Infrastructure related changes',
			'🧑‍💻': 'Improve developer experience',
			'💸': 'Add sponsorships or money related infrastructure',
			'🧵': 'Add or update code related to multithreading or concurrency',
			'🦺': 'Add or update code related to validation',
		},
		null,
		2
	)}`,
	'subject+body': 'Output only the subject line; the body is generated separately.',
};

export const generatePrompt = (
	locale: string,
	maxLength: number,
	type: CommitType,
	customPrompt?: string
) =>
	[
		'Generate a concise git commit message title in present tense that precisely describes the key changes in the following code diff. Focus on what was changed, not just file names. Provide only the title, no description or body.',
		`Message language: ${locale}`,
		`Commit message must be a maximum of ${maxLength} characters.`,
		'Exclude anything unnecessary such as translation. Your entire response will be passed directly into git commit.',
		`IMPORTANT: Do not include any explanations, introductions, or additional text. Do not wrap the commit message in quotes or any other formatting. The commit message must not exceed ${maxLength} characters. Respond with ONLY the commit message text.`,
		'Be specific: include concrete details (package names, versions, functionality) rather than generic statements.',
		customPrompt,
		commitTypes[type],
		specifyCommitFormat(type),
	]
		.filter(Boolean)
		.join('\n');

/**
 * Prompt for generating a commit message body/description given a title and diff.
 * Used when the user has (or generated) a title and wants a detailed description.
 */
export const generateDescriptionPrompt = (
	locale: string,
	maxLength: number,
	customPrompt?: string
) =>
	[
		'You are generating the short body (description) of a git commit message. You are given the commit title and the code diff.',
		'Output must be brief: use 3–6 bullet points (one short line each), or 2–4 short sentences. No long paragraphs. Focus on what changed and why, in present tense.',
		`Git convention: each line at most ${maxLength} characters. When a bullet line wraps, indent the continuation with 2 spaces so it aligns under the bullet text.`,
		'Do not repeat the title. No meta-commentary (e.g. "This commit..."). Respond with ONLY the commit body.',
		`Message language: ${locale}`,
		customPrompt,
	]
		.filter(Boolean)
		.join('\n');
