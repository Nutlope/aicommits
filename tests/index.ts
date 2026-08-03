import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli/index.js'));
	runTestSuite(import('./specs/auto-update.js'));
	runTestSuite(import('./specs/generate-commit-message.js'));
	runTestSuite(import('./specs/providers.js'));
	runTestSuite(import('./specs/error.js'));
	runTestSuite(import('./specs/commit-helpers.js'));
	runTestSuite(import('./specs/config.js'));
	runTestSuite(import('./specs/git-hook.js'));
});
