import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli/index.js'));
	runTestSuite(import('./specs/config.js'));
});
