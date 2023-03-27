import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
	describe('OpenAI', ({ runTestSuite }) => {
		runTestSuite(import('./conventional-commits.js'));
	});
});
