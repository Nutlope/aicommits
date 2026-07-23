import { expect, testSuite } from 'manten';
import { isModelUnavailableError } from '../../src/utils/error.js';

export default testSuite(({ describe }) => {
	describe('model availability errors', ({ test }) => {
		test('recognizes provider errors through their cause chain', () => {
			const error = Object.assign(new Error('Generation failed'), {
				cause: Object.assign(new Error('Request failed'), { statusCode: 404 }),
			});
			expect(isModelUnavailableError(error)).toBe(true);
		});

		test('does not treat unrelated API failures as unavailable models', () => {
			const error = Object.assign(new Error('Service unavailable'), {
				statusCode: 503,
			});
			expect(isModelUnavailableError(error)).toBe(false);
		});
	});
});
