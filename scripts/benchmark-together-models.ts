import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import { getProvider } from '../src/feature/providers/index.js';
import { supportsTogetherAgenticGeneration } from '../src/feature/providers/together.js';
import { getConfig } from '../src/utils/config-runtime.js';
import { generateCommitMessage as generateCandidateMessage } from '../src/feature/generate-commit-message.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LEGACY_REF = '8a4d2316e5ce52e2cafcdde19d03b1f0ff98df49';
const LEGACY_MAX_FILES = 50;
const LEGACY_CHUNK_SIZE = 10;
const LEGACY_MAX_DIFF_LENGTH = 30_000;
const MAX_LENGTH = 72;
const TIMEOUT = Number(process.env.AICOMMITS_BENCHMARK_TIMEOUT || 60_000);
const REPEATS = Number(process.env.AICOMMITS_BENCHMARK_REPEATS || 1);

const defaultModels = [
	'zai-org/GLM-5.3-Flash',
	'deepseek-ai/DeepSeek-V4-Flash-0731',
	'moonshotai/Kimi-K3',
];

const smallFixtures = [
	{
		repo: 'sindresorhus/execa',
		pr: 1232,
		title: 'Fix input with inherited stdin',
		base: 'f3a2e8481a1e9138de3895827895c834078b9456',
		head: '261e117bba4bb3df7bc74f3dcfc74eaba43f12b6',
	},
	{
		repo: 'pnpm/pnpm',
		pr: 10370,
		title:
			'fix: `pnpm add` incorrectly modifies a catalog entry in `pnpm-workspace.yaml` to its exact version',
		base: 'd404c55ac8d8ca507db24ce4c9446af2fe4088a7',
		head: '0abbcdd01349d714d1785e9a5d295ececd260de0',
	},
	{
		repo: 'vercel/ai',
		pr: 11410,
		title: 'Fix bedrock ConverseStream undocumented `/delta/stop_sequence`',
		base: 'ea6609a2be4ae0c1394a5d60ccb75464733ed48f',
		head: '50e380463a54d95ed8c42a065cbb404224134e5d',
	},
];

const largeFixtures = [
	{
		repo: 'vercel/ai',
		pr: 5700,
		title: 'feat(embedding-model-v2): add response body field',
		base: '393138bae3731699e6823fa542bd14800c928f02',
		head: '0563686d3b40bcbfce641a3044d16d113cec09c5',
	},
	{
		repo: 'vercel/ai',
		pr: 5882,
		title: 'chore: restructure language model supported urls',
		base: '7ea4132624d8ab83f1f9713020e4c76bd6c2036b',
		head: '5ca4a746af5f3c79cc32e8d4f4d7b8877a0e5d5c',
	},
	{
		repo: 'vercel/ai',
		pr: 5759,
		title: 'chore: refactor text parts (spec)',
		base: '443d8ec6bd7ee5c3e4218ef7228596aa0bebade5',
		head: '2cc30b82dfd897610d48a46f5f7bad50162d3e70',
	},
];

const suite = process.env.AICOMMITS_BENCHMARK_SUITE || 'small';
const fixtures = suite === 'large' ? largeFixtures : smallFixtures;
const models = process.env.AICOMMITS_BENCHMARK_MODELS
	? process.env.AICOMMITS_BENCHMARK_MODELS.split(',').filter(Boolean)
	: defaultModels;

type LegacyUsage = {
	total_tokens?: number;
	totalTokens?: number;
};

type LegacyResult = {
	messages: string[];
	usage: LegacyUsage;
};

type LegacyGeneratorOptions = {
	baseUrl: string;
	apiKey: string;
	model: string;
	locale: string;
	maxLength: number;
	type: 'conventional';
	timeout: number;
};

type LegacyGenerator = (
	options: LegacyGeneratorOptions & {
		diff: string;
		completions: number;
	}
) => Promise<LegacyResult>;

type LegacyCombiner = (
	options: LegacyGeneratorOptions & { messages: string[] }
) => Promise<LegacyResult>;

const measure = async <Value>(run: () => Promise<Value>) => {
	const start = performance.now();
	try {
		return {
			status: 'ok' as const,
			value: await run(),
			latencyMs: Math.round(performance.now() - start),
		};
	} catch (error) {
		return {
			status: 'error' as const,
			error:
				error instanceof Error
					? error.message.split('\n')[0]
					: String(error),
			latencyMs: Math.round(performance.now() - start),
		};
	}
};

const loadLegacyRuntime = async () => {
	const worktree = await mkdtemp(join(tmpdir(), 'aicommits-legacy-'));
	await rm(worktree, { recursive: true, force: true });
	await execa(
		'git',
		['worktree', 'add', '--detach', '--quiet', worktree, LEGACY_REF],
		{ cwd: repoRoot }
	);
	await symlink(join(repoRoot, 'node_modules'), join(worktree, 'node_modules'));
	const legacyModule = await import(
		pathToFileURL(join(worktree, 'src/utils/openai.ts')).href
	);
	return {
		generate: legacyModule.generateCommitMessage as LegacyGenerator,
		combine: legacyModule.combineCommitMessages as LegacyCombiner,
		cleanup: async () => {
			await rm(join(worktree, 'node_modules'));
			await execa('git', ['worktree', 'remove', worktree], { cwd: repoRoot });
		},
	};
};

type LegacyRuntime = Awaited<ReturnType<typeof loadLegacyRuntime>>;
type PreparedFixture = Awaited<ReturnType<typeof prepareFixture>>;

const getLegacyTokenCount = (usage: LegacyUsage) =>
	usage.total_tokens ?? usage.totalTokens ?? 0;

const truncateLegacyDiff = (diff: string) =>
	diff.length > LEGACY_MAX_DIFF_LENGTH
		? `${diff.slice(0, LEGACY_MAX_DIFF_LENGTH)}\n\n[Diff truncated due to size]`
		: diff;

const generateLegacyCliMessage = async ({
	legacy,
	staged,
	baseUrl,
	apiKey,
	model,
}: {
	legacy: LegacyRuntime;
	staged: PreparedFixture;
	baseUrl: string;
	apiKey: string;
	model: string;
}): Promise<{ messages: string[]; usage: { total_tokens: number } }> => {
	const options: LegacyGeneratorOptions = {
		baseUrl,
		apiKey,
		model,
		locale: 'en',
		maxLength: MAX_LENGTH,
		type: 'conventional',
		timeout: TIMEOUT,
	};
	const generate = (diff: string) =>
		legacy.generate({
			...options,
			diff: truncateLegacyDiff(diff),
			completions: 1,
		});

	if (staged.files.length <= LEGACY_MAX_FILES) {
		const result = await generate(staged.diff);
		return {
			messages: result.messages,
			usage: { total_tokens: getLegacyTokenCount(result.usage) },
		};
	}

	const messages: string[] = [];
	let totalTokens = 0;
	for (
		let index = 0;
		index < staged.files.length;
		index += LEGACY_CHUNK_SIZE
	) {
		const paths = staged.files.slice(index, index + LEGACY_CHUNK_SIZE);
		const { stdout } = await execa(
			'git',
			[
				'--literal-pathspecs',
				'diff',
				'--cached',
				'--diff-algorithm=minimal',
				'--',
				...paths,
			],
			{ cwd: staged.cwd }
		);
		const result = await generate(stdout);
		messages.push(...result.messages);
		totalTokens += getLegacyTokenCount(result.usage);
	}

	const combined = await legacy.combine({ ...options, messages });
	return {
		messages: combined.messages,
		usage: {
			total_tokens: totalTokens + getLegacyTokenCount(combined.usage),
		},
	};
};

const prepareFixture = async (fixture: (typeof fixtures)[number]) => {
	const cwd = await mkdtemp(join(tmpdir(), 'aicommits-model-benchmark-'));
	try {
		await execa('git', ['init', '--quiet'], { cwd });
		await execa(
			'git',
			[
				'fetch',
				'--quiet',
				'--depth=1',
				`https://github.com/${fixture.repo}.git`,
				fixture.base,
				fixture.head,
			],
			{ cwd }
		);
		await execa('git', ['checkout', '--quiet', fixture.base], { cwd });
		const { stdout: patch } = await execa(
			'git',
			['diff', '--binary', fixture.base, fixture.head],
			{ cwd, stripFinalNewline: false }
		);
		await execa('git', ['apply', '--index', '--whitespace=nowarn'], {
			cwd,
			input: patch,
		});
		const { stdout: diff } = await execa(
			'git',
			['diff', '--cached', '--diff-algorithm=minimal'],
			{ cwd }
		);
		const { stdout: fileOutput } = await execa(
			'git',
			['diff', '--cached', '--name-only'],
			{ cwd }
		);
		return {
			cwd,
			diff,
			files: fileOutput.split('\n').filter(Boolean),
		};
	} catch (error) {
		await rm(cwd, { recursive: true, force: true });
		throw error;
	}
};

const main = async () => {
	const preparedFixtures = await Promise.all(fixtures.map(prepareFixture));
	const preparedFixtureData = fixtures.map((fixture, index) => ({
		...fixture,
		files: preparedFixtures[index].files.length,
		diffCharacters: preparedFixtures[index].diff.length,
	}));
	if (process.env.AICOMMITS_BENCHMARK_PREPARE_ONLY) {
		console.log(JSON.stringify({ suite, fixtures: preparedFixtureData }, null, 2));
		await Promise.all(
			preparedFixtures.map((fixture) =>
				rm(fixture.cwd, { recursive: true, force: true })
			)
		);
		return;
	}

	const config = await getConfig();
	const provider = getProvider(config);
	if (!provider || provider.name !== 'togetherai') {
		throw new Error('Benchmark requires a configured Together AI provider.');
	}
	const catalog = await provider.getModels();
	if (catalog.error) {
		throw new Error(`Could not load Together serverless models: ${catalog.error}`);
	}
	const unavailableModels = models.filter(
		(model) => !catalog.models.includes(model)
	);
	if (unavailableModels.length > 0) {
		throw new Error(
			`Models are not available on Together serverless: ${unavailableModels.join(', ')}`
		);
	}

	const legacy = await loadLegacyRuntime();
	const results = [];
	try {
		for (const model of models) {
			const candidateMode = supportsTogetherAgenticGeneration(model)
				? 'agentic'
				: 'fallback';
			const modelResults = [];
			for (let index = 0; index < fixtures.length; index += 1) {
				for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
					const fixture = fixtures[index];
					const staged = preparedFixtures[index];
					const legacyResult = await measure(() =>
						generateLegacyCliMessage({
							legacy,
							staged,
							baseUrl: provider.getBaseUrl(),
							apiKey: provider.getApiKey() || '',
							model,
						})
					);
					const candidateResult = await measure(() =>
						generateCandidateMessage({
							model: provider.getGenerationModel(model),
							cwd: staged.cwd,
							files: staged.files,
							type: 'conventional',
							locale: 'en',
							maxLength: MAX_LENGTH,
							includeBody: false,
							timeout: TIMEOUT,
						})
					);

					modelResults.push({
						fixture: `${fixture.repo}#${fixture.pr}`,
						title: fixture.title,
						attempt,
						quality: {
							verdict: null,
							note: 'Compare both messages with the reference title.',
						},
						legacy:
							legacyResult.status === 'ok'
								? {
										status: 'ok',
										message: legacyResult.value.messages[0],
										latencyMs: legacyResult.latencyMs,
										tokens: legacyResult.value.usage.total_tokens,
								  }
								: legacyResult,
						candidate:
							candidateResult.status === 'ok'
								? {
										status: 'ok',
										mode: candidateMode,
										message: candidateResult.value.message.subject,
										latencyMs: candidateResult.latencyMs,
										tokens: candidateResult.value.usage.totalTokens,
										steps: candidateResult.value.steps,
								  }
								: { ...candidateResult, mode: candidateMode },
					});
					console.error(
						`Completed ${model} ${fixture.repo}#${fixture.pr} attempt ${attempt}`
					);

					if (index === 0 && candidateResult.status === 'error') break;
				}
			}
			results.push({ model, candidateMode, results: modelResults });
			console.error(`Completed ${model}`);
		}
	} finally {
		await Promise.all(
			preparedFixtures.map((fixture) =>
				rm(fixture.cwd, { recursive: true, force: true })
			)
		);
		await legacy.cleanup();
	}

	const output = JSON.stringify(
		{
			suite,
			repeats: REPEATS,
			models,
			legacy: {
				ref: LEGACY_REF,
				orchestration: 'CLI truncation and chunking',
			},
			fixtures: preparedFixtureData,
			results,
		},
		null,
		2
	);
	const outputPath = process.env.AICOMMITS_BENCHMARK_OUTPUT;
	if (outputPath) {
		await writeFile(outputPath, `${output}\n`);
	} else {
		console.log(output);
	}
};

await main();
