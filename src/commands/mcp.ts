import { command } from 'cleye';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pkg from '../../package.json';
import { assertGitRepo, getStagedFiles } from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { generateCommitMessages } from '../feature/generate-commit-messages.js';

const { version } = pkg;

const commitTypes = [
	'plain',
	'conventional',
	'conventional+body',
	'gitmoji',
	'subject+body',
] as const;

type GenerateCommitMessageArgs = {
	context?: string;
	type?: (typeof commitTypes)[number];
	count?: number;
	exclude?: string[];
};

const toolError = (text: string) => ({
	content: [{ type: 'text' as const, text }],
	isError: true,
});

const handleGenerate = async (args: GenerateCommitMessageArgs) => {
	try {
		const gitRoot = await assertGitRepo();

		const stagedFiles = await getStagedFiles(args.exclude);
		if (!stagedFiles) {
			return toolError(
				'No staged changes found. Stage files with `git add` before calling this tool.'
			);
		}

		const config = await getConfig({
			generate: args.count?.toString(),
			type: args.type,
		});

		if (!getProvider(config)) {
			return toolError(
				'No aicommits configuration found. Run `aicommits setup` in an interactive terminal first.'
			);
		}

		const messages = await generateCommitMessages({
			config,
			gitRoot,
			files: stagedFiles,
			customPrompt: args.context,
			spinner: null,
		});

		const text =
			messages.length === 1
				? messages[0]
				: messages
						.map((message, index) => `${index + 1}. ${message}`)
						.join('\n\n');

		return { content: [{ type: 'text' as const, text }] };
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}
};

const startMcpServer = async () => {
	const server = new McpServer({ name: 'aicommits', version });

	server.registerTool(
		'generate_commit_message',
		{
			description:
				'Generate git commit message(s) from staged changes. Returns text; does NOT commit. Pass `context` describing what you are working on and why — it is sent to the AI along with the staged diff. Body formats (conventional+body, subject+body) always return a single message.',
			inputSchema: {
				context: z
					.string()
					.optional()
					.describe('What you are working on and why'),
				type: z
					.enum(commitTypes)
					.optional()
					.describe('Commit format (default: plain)'),
				count: z
					.number()
					.int()
					.min(1)
					.max(5)
					.optional()
					.describe('Number of message variants (default 1)'),
				exclude: z
					.array(z.string())
					.optional()
					.describe('Files to exclude from analysis'),
			},
		},
		handleGenerate
	);

	const transport = new StdioServerTransport();
	transport.onclose = () => process.exit(0);
	await server.connect(transport);
};

export default command(
	{
		name: 'mcp',
		description: 'Start an MCP server exposing commit message generation over stdio',
		help: {
			description: 'Start an MCP server exposing commit message generation over stdio',
		},
	},
	() => {
		startMcpServer().catch((error) => {
			process.stderr.write(`${error}\n`);
			process.exit(1);
		});
	}
);