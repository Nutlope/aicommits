import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli.js'));
	runTestSuite(import('./specs/config.js'));
});
