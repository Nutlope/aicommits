export type GenerationProgress = {
	stage: 'reading-diff' | 'waiting' | 'waiting-complete' | 'thinking' | 'receiving' | 'tool' | 'validating';
};

export type OnGenerationProgress = (event: GenerationProgress) => void;

type ProgressSpinner = {
	start: (message: string) => void;
	message: (message: string) => void;
	stop: (message: string, code?: number) => void;
};

type TokenUsage = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
};

const formatTokenUsage = (usages: Array<TokenUsage | undefined>) => {
	const sum = (counts: Array<number | undefined>) =>
		counts.every((count) => count !== undefined)
			? counts.reduce<number>((total, count) => total + count!, 0)
			: undefined;
	const total = sum(usages.map((usage) => usage?.totalTokens ?? (
		usage?.inputTokens !== undefined && usage.outputTokens !== undefined
			? usage.inputTokens + usage.outputTokens
			: undefined
	)));
	if (total === undefined) return 'tokens unavailable';
	const input = sum(usages.map((usage) => usage?.inputTokens));
	const output = sum(usages.map((usage) => usage?.outputTokens));
	const details = input !== undefined && output !== undefined
		? ` (in ${input.toLocaleString('en-US')} / out ${output.toLocaleString('en-US')})`
		: '';
	return `${total.toLocaleString('en-US')} tokens${details}`;
};

/** One display per generation attempt, including concurrent candidates. */
export const startGenerationProgress = (
	spinner: ProgressSpinner,
	{ provider, count }: { provider: string; count: number }
) => {
	const labels: Record<GenerationProgress['stage'], string> = {
		'reading-diff': 'Reading staged changes',
		waiting: 'Requesting AI, waiting for response',
		'waiting-complete': 'Requesting AI, waiting for full response (non-streaming)',
		thinking: 'AI is thinking',
		receiving: 'Receiving AI response',
		tool: 'AI is calling a tool',
		validating: 'Validating generated message',
	};
	const startedAt = Date.now();
	const candidates = Array.from({ length: count }, () => ({
		stage: 'reading-diff' as GenerationProgress['stage'],
		done: false,
		usage: undefined as TokenUsage | undefined,
	}));
	let stopped = false;
	const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);
	const render = () => {
		const completed = candidates.filter(({ done }) => done).length;
		const active = candidates.find(({ done }) => !done);
		const status = labels[active?.stage ?? 'validating'];
		const counter = count > 1 ? ` · ${completed}/${count}` : '';
		return `${status} · ${provider}${counter} · elapsed ${elapsed()}s`;
	};
	spinner.start(render());
	const timer = setInterval(() => spinner.message(render()), 100);
	timer.unref();
	return {
		update: (index: number, event: GenerationProgress) => {
			if (stopped) return;
			candidates[index].stage = event.stage;
		},
		complete: (index: number, usage?: TokenUsage) => {
			if (stopped) return;
			candidates[index].done = true;
			candidates[index].usage = usage;
		},
		stop: (success: boolean) => {
			if (stopped) return;
			stopped = true;
			clearInterval(timer);
			const tokens = success
				? ` · ${formatTokenUsage(candidates.map(({ usage }) => usage))}`
				: '';
			spinner.stop(
				`${success ? '✅ Generation completed' : '❌ Generation failed'} in ${elapsed()}s${tokens}`,
				success ? 0 : 1
			);
		},
	};
};
