import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/openai.spec.js'));
	runTestSuite(import('./specs/cli.spec.js'));
	runTestSuite(import('./specs/config.spec.js'));
});
