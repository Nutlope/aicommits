import fs from 'fs/promises';
import {
	intro, outro, spinner,
} from '@clack/prompts';
import {
	black, green, red, bgCyan,
} from 'kolorist';
import { getStagedDiff } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage } from '../utils/openai.js';

const [messageFilePath, commitSource] = process.argv.slice(2);

export default () => (async () => {
	if (!messageFilePath) {
		throw new Error('Commit message file path is missing. This file should be called from the "prepare-commit-msg" git hook');
	}

	// If a commit message is passed in, ignore
	if (commitSource) {
		return;
	}

	// All staged files can be ignored by our filter
	const staged = await getStagedDiff();
	if (!staged) {
		return;
	}

	intro(bgCyan(black(' aicommits ')));

	const { OPENAI_KEY, generate } = await getConfig();
	if (!OPENAI_KEY) {
		throw new Error('Please set your OpenAI API key in ~/.aicommits');
	}

	const s = spinner();
	s.start('The AI is analyzing your changes');
	const messages = await generateCommitMessage(
		OPENAI_KEY,
		staged!.diff,
		generate || 1,
	);
	s.stop('Changes analyzed');

	const hasMultipleMessages = messages.length > 1;
	let instructions = `# 🤖 AI generated commit${hasMultipleMessages ? 's' : ''}\n`;

	if (hasMultipleMessages) {
		instructions += '# Select one of the following messages by uncommeting:\n';
		instructions += `\n${messages.map(message => `# ${message}`).join('\n')}`;
	} else {
		instructions += '# Edit the message below and commit:\n';
		instructions += `\n${messages[0]}\n`;
	}

	await fs.appendFile(
		messageFilePath,
		instructions,
	);
	outro(`${green('✔')} Saved commit message!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	process.exit(1);
});
