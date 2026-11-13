import { testSuite, expect } from 'manten';
import { setTimeout as delay } from 'node:timers/promises';
import { startGenerationProgress } from '../../src/feature/generation-progress.js';

export default testSuite(({ test }) => {
	for (const { name, usages, expected } of [
		{
			name: 'totals usage across candidates',
			usages: [
				{ inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
				{ inputTokens: 100, outputTokens: 34, totalTokens: 134 },
			],
			expected: '1,334 tokens (in 1,100 / out 234)',
		},
		{
			name: 'derives the total from input and output counts',
			usages: [{ inputTokens: 10, outputTokens: 5 }],
			expected: '15 tokens (in 10 / out 5)',
		},
		{
			name: 'preserves reported zero usage',
			usages: [{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }],
			expected: '0 tokens (in 0 / out 0)',
		},
		{
			name: 'shows unavailable when no usage is returned',
			usages: [undefined],
			expected: 'tokens unavailable',
		},
		{
			name: 'does not present partial candidate usage as a complete total',
			usages: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }, undefined],
			expected: 'tokens unavailable',
		},
		{
			name: 'supports providers returning only a total',
			usages: [{ totalTokens: 42 }],
			expected: '42 tokens',
		},
	]) {
		test(`shows tokens alongside elapsed time: ${name}`, () => {
			const stops: string[] = [];
			const progress = startGenerationProgress({
				start: () => {},
				message: () => {},
				stop: (message) => { stops.push(message); },
			}, { provider: 'OpenAI', count: usages.length });
			try {
				usages.forEach((usage, index) => progress.complete(index, usage));
			} finally {
				progress.stop(true);
			}
			expect(stops.length).toBe(1);
			expect(stops[0]).toMatch(/^✅ Generation completed in \d+\.\ds · /);
			expect(stops[0]).toMatch(expected);
			expect(stops[0]).not.toMatch('\n');
		});
	}

	test('keeps timing during silence and stops updates after failure', async () => {
		const messages: string[] = [];
		const stops: { message: string; code?: number }[] = [];
		const progress = startGenerationProgress({
			start: (message) => messages.push(message),
			message: (message) => messages.push(message),
			stop: (message, code) => { stops.push({ message, code }); },
		}, { provider: 'Codex', count: 1 });
		try {
			progress.update(0, { stage: 'waiting' });
			await delay(250);
			expect(messages.length).toBeGreaterThan(1);
			expect(messages[messages.length - 1]).toMatch('waiting for response');
			expect(messages[messages.length - 1]).not.toMatch('0.0s');
		} finally {
			progress.stop(false);
		}
		const count = messages.length;
		progress.update(0, { stage: 'receiving' });
		progress.stop(true);
		await delay(150);
		expect(messages.length).toBe(count);
		expect(stops.length).toBe(1);
		expect(stops[0].code).toBe(1);
		expect(stops[0].message).toMatch('Generation failed');
	});

	test('displays the remaining candidate after another finishes', async () => {
		const messages: string[] = [];
		const progress = startGenerationProgress({
			start: (message) => messages.push(message),
			message: (message) => messages.push(message),
			stop: (message) => messages.push(message),
		}, { provider: 'OpenAI', count: 2 });
		try {
			progress.update(0, { stage: 'validating' });
			progress.complete(0);
			progress.update(1, { stage: 'receiving' });
			await delay(150);
			expect(messages[messages.length - 1]).toMatch('Receiving AI response');
			expect(messages[messages.length - 1]).toMatch('1/2');
		} finally {
			progress.stop(true);
		}
		expect(messages[messages.length - 1]).toMatch('Generation completed');
	});
});
