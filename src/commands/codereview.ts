import { command } from 'cleye';
import { red } from 'kolorist';
import { handleCliError } from '../utils/error.js';
import aicodereviews from './aicodereviews';

const rawArgv = process.argv.slice(2);

export default command({
	name: 'makecodereview',
	flags: {
		generate: {
			type: Number,
			description: 'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
			alias: 'g',
		},
		exclude: {
			type: [String],
			description: 'Files to exclude from AI analysis',
			alias: 'x',
		},
		all: {
			type: Boolean,
			description: 'Automatically stage changes in tracked files for the commit',
			alias: 'a',
			default: false,
		},
		type: {
			type: String,
			description: 'Type of commit message to generate',
			alias: 't',
		},
		frombranch: {
			type: String,
			description: 'Branch from you want generate the code review',
		},
		tobranch: {
			type: String,
			description: 'Branch From you want generate the code review',
			default: 'main',
		},
	},

	// parameters: ['<mode>', '<key=value...>'],
}, (argv) => {
	(async () => {
		aicodereviews(
			argv.flags.generate,
			argv.flags.exclude,
			argv.flags.all,
			argv.flags.type,
			argv.flags.frombranch,
			argv.flags.tobranch,
			rawArgv,
		);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
});
