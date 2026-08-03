// @ts-expect-error @semantic-release/commit-analyzer does not publish types.
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { expect, testSuite } from 'manten';
import pkg from '../../package.json';

const releasePlugins = 'plugins' in pkg.release ? pkg.release.plugins : [];
const commitAnalyzer = releasePlugins.find(
	(plugin) =>
		Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
);
const analyzerOptions = Array.isArray(commitAnalyzer)
	? commitAnalyzer[1]
	: {};

export default testSuite(({ describe }) => {
	describe('release', ({ test }) => {
		test('classifies the exact v4 squash message as a major release', async () => {
			const releaseType = await analyzeCommits(analyzerOptions, {
				commits: [
					{
						message:
							'feat!: replace one-shot commit generation with an agentic flow (#352)\n\n' +
							'Integrate bounded agentic generation.\\n\\nBREAKING CHANGE: compatible models now use a structured agent flow.',
					},
				],
				logger: { log() {} },
			} as never);

			expect(releaseType).toBe('major');
		});
	});
});
