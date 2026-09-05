import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
	describe('CLI', ({ runTestSuite }) => {
		runTestSuite(import('./error-cases.js'));
		runTestSuite(import('./headless.js'));
		runTestSuite(import('./commits.js'));
		runTestSuite(import('./no-verify.js'));
		runTestSuite(import('./mcp.js'));
	});
});
