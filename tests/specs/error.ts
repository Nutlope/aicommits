import { expect, testSuite } from 'manten';
import {
	isModelUnavailableError,
	isToolUnsupportedError,
} from '../../src/utils/error.js';

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

	describe('tool support errors', ({ test }) => {
		test('recognizes rejected tool parameters through provider response bodies', () => {
			const error = Object.assign(new Error('Generation failed'), {
				cause: {
					responseBody: JSON.stringify({
						error: { message: "Unsupported parameter: 'tools'" },
					}),
				},
			});
			expect(isToolUnsupportedError(error)).toBe(true);
		});

		test('does not treat unrelated bad requests as tool incompatibility', () => {
			expect(
				isToolUnsupportedError(new Error('Invalid parameter: temperature'))
			).toBe(false);
			expect(
				isToolUnsupportedError(
					new Error("Model called tool 'search' which is not available")
				)
			).toBe(false);
		});
	});
});
