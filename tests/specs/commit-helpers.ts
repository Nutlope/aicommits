import { expect, testSuite } from 'manten';
import { getCommitMessage } from '../../src/utils/commit-helpers.js';

const cancel = Symbol('cancel');

const createPrompts = (answers: unknown[]) => {
	const selectCalls: unknown[] = [];
	const textCalls: unknown[] = [];
	const queue = [...answers];

	return {
		selectCalls,
		textCalls,
		dependencies: {
			isInteractive: () => true,
			isCancel: (value: unknown) => value === cancel,
			select: async (options: unknown) => {
				selectCalls.push(options);
				return queue.shift();
			},
			text: async (options: unknown) => {
				textCalls.push(options);
				return queue.shift();
			},
		},
	};
};

export default testSuite(({ describe }) => {
	describe('commit message confirmation', ({ test }) => {
		test('accepts a generated message from the terminal action prompt', async () => {
			const prompts = createPrompts(['accept']);

			const result = await getCommitMessage(
				['fix: preserve the generated message'],
				false,
				prompts.dependencies
			);

			expect(result).toBe('fix: preserve the generated message');
			expect(prompts.selectCalls.length).toBe(1);
			expect(prompts.textCalls.length).toBe(0);
		});

		test('edits the subject inline and preserves the generated body', async () => {
			const prompts = createPrompts([
				'edit',
				'fix: use the edited subject',
			]);

			const result = await getCommitMessage(
				[
					'fix: use the generated subject\n\nKeep this generated explanation intact.',
				],
				false,
				prompts.dependencies
			);

			expect(result).toBe(
				'fix: use the edited subject\n\nKeep this generated explanation intact.'
			);
			expect(prompts.textCalls.length).toBe(1);
			expect(
				(prompts.textCalls[0] as { message: string }).message
			).toBe('Edit commit message subject:');
			expect(
				(prompts.textCalls[0] as { initialValue: string }).initialValue
			).toBe('fix: use the generated subject');
		});

		test('cancels when No is selected', async () => {
			const prompts = createPrompts(['cancel']);

			const result = await getCommitMessage(
				['fix: cancel this commit'],
				false,
				prompts.dependencies
			);

			expect(result).toBe(null);
		});

		test('selects among generated messages before offering actions', async () => {
			const prompts = createPrompts([
				'fix: use the second message',
				'accept',
			]);

			const result = await getCommitMessage(
				[
					'fix: use the first message',
					'fix: use the second message',
				],
				false,
				prompts.dependencies
			);

			expect(result).toBe('fix: use the second message');
			expect(prompts.selectCalls.length).toBe(2);
		});
	});
});
