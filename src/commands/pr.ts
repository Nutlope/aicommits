import { command } from 'cleye';
import { execa } from 'execa';
import { black, green, bgCyan } from 'kolorist';
import { intro, outro, spinner, confirm, isCancel } from '@clack/prompts';
import { assertGitRepo } from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { generateText } from 'ai';
import { KnownError, handleCommandError } from '../utils/error.js';
import { createChatProvider, formatProviderError } from '../utils/openai.js';
import { isInteractive } from '../utils/headless.js';

type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure';

interface RepoInfo {
	provider: GitProvider;
	owner: string;
	repo: string;
}

function parseRemoteUrl(remoteUrl: string): RepoInfo {
	const githubMatch = remoteUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
	if (githubMatch) {
		return { provider: 'github', owner: githubMatch[1], repo: githubMatch[2] };
	}

	const gitlabMatch = remoteUrl.match(/gitlab\.com[\/:]([^\/]+)\/([^\/\.]+)/);
	if (gitlabMatch) {
		return { provider: 'gitlab', owner: gitlabMatch[1], repo: gitlabMatch[2] };
	}

	const bitbucketMatch = remoteUrl.match(/bitbucket\.org[\/:]([^\/]+)\/([^\/\.]+)/);
	if (bitbucketMatch) {
		return { provider: 'bitbucket', owner: bitbucketMatch[1], repo: bitbucketMatch[2] };
	}

	const azureMatch = remoteUrl.match(/dev\.azure\.com[\/:]([^\/]+)\/([^\/\.]+)|vs-internal\.visualstudio\.com[\/:]([^\/]+)\/([^\/\.]+)/);
	if (azureMatch) {
		return { provider: 'azure', owner: azureMatch[1] || azureMatch[3], repo: azureMatch[2] || azureMatch[4] };
	}

	throw new KnownError(
		`Unsupported git provider. Supported: GitHub, GitLab, Bitbucket, Azure DevOps.\nRemote URL: ${remoteUrl}`
	);
}

function getPrUrl(
	provider: GitProvider,
	owner: string,
	repo: string,
	defaultBranch: string,
	currentBranch: string,
	title: string,
	body: string
): string {
	const encodedTitle = encodeURIComponent(title);
	const encodedBody = encodeURIComponent(body);

	switch (provider) {
		case 'github':
			return `https://github.com/${owner}/${repo}/compare/${defaultBranch}...${currentBranch}?expand=1&title=${encodedTitle}&body=${encodedBody}`;
		case 'gitlab':
			return `https://gitlab.com/${owner}/${repo}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(currentBranch)}&merge_request[target_branch]=${encodeURIComponent(defaultBranch)}&merge_request[title]=${encodedTitle}&merge_request[description]=${encodedBody}`;
		case 'bitbucket':
			return `https://bitbucket.org/${owner}/${repo}/pull-requests/new?source=${encodeURIComponent(currentBranch)}&dest=${encodeURIComponent(defaultBranch)}&title=${encodedTitle}&description=${encodedBody}`;
		case 'azure':
			return `https://dev.azure.com/${owner}/${repo}/_git/${repo}/pullrequestcreate?sourceRef=${encodeURIComponent(currentBranch)}&targetRef=${encodeURIComponent(defaultBranch)}&title=${encodedTitle}&description=${encodedBody}`;
	}
}

export default command(
	{
		name: 'pr',
		description:
			'[beta 🚧] Generate and create a PR (GitHub/GitLab/Bitbucket/Azure) based on branch diff',
		help: {
			description:
				'[beta 🚧] Generate and create a PR (GitHub/GitLab/Bitbucket/Azure) based on branch diff',
		},
	},
	() => {
		(async () => {
			if (!isInteractive()) {
				throw new KnownError(
					'Interactive terminal required for PR creation.'
				);
			}

			intro(bgCyan(black(' aicommits pr ')));

			await assertGitRepo();

			// Get current branch
			const { stdout: currentBranch } = await execa('git', [
				'branch',
				'--show-current',
			]);
			if (!currentBranch.trim()) {
				throw new KnownError('Not on a branch');
			}

			// Get repo URL
			const { stdout: remoteUrl } = await execa('git', [
				'remote',
				'get-url',
				'origin',
			]);
			const repoInfo = parseRemoteUrl(remoteUrl);
			const { provider, owner, repo } = repoInfo;

			// Get default branch from git remote
			let defaultBranch = 'main';
			try {
				const { stdout } = await execa('git', [
					'symbolic-ref',
					'refs/remotes/origin/HEAD',
				]);
				defaultBranch = stdout.trim().replace('refs/remotes/origin/', '');
			} catch {
				// Fallback to main if git command fails
			}

			// Check if on default branch
			if (currentBranch.trim() === defaultBranch) {
				throw new KnownError('PR creation requires being on a feature branch, not the default branch. Please switch to a feature branch with changes.');
			}

			// Get diff from default branch to current branch
			let diff;
			try {
				const { stdout } = await execa('git', [
					'diff',
					`origin/${defaultBranch}..HEAD`,
				]);
				diff = stdout;
			} catch {
				throw new KnownError(`Could not get diff from origin/${defaultBranch}`);
			}

			if (!diff) {
				throw new KnownError('No changes to create PR from');
			}

			// Count changed files
			const numFiles = diff
				.split('\n')
				.filter((line) => line.startsWith('diff --git')).length;

			// Limit diff size to avoid token limits
			const maxDiffLength = 30000; // Approximate character limit
			if (diff.length > maxDiffLength) {
				diff =
					diff.substring(0, maxDiffLength) + '\n\n[Diff truncated due to size]';
			}

			const config = await getConfig();
			const configProvider = await getProvider(config);

			if (!configProvider) {
				throw new KnownError('No provider configured');
			}

			let baseUrl = configProvider.getBaseUrl();
			if (!baseUrl || baseUrl === '') {
				throw new KnownError(
					'Base URL not configured. Please run `aicommits setup` to configure your provider.'
				);
			}
			if (!baseUrl.endsWith('/v1')) {
				baseUrl += '/v1';
			}
			const apiKey = configProvider.getApiKey();
			if (!apiKey) {
				throw new KnownError(
					'API key not configured. Please run `aicommits setup` to configure your provider.'
				);
			}
			const aiProvider = createChatProvider(baseUrl, apiKey);

			const generating = spinner();
			generating.start(
				`Generating PR title and description (${numFiles} files changed)`
			);

			const startTime = Date.now();

			// Generate PR title
			let titleResult;
			try {
				titleResult = await generateText({
					model: aiProvider(config.model) as any,
					system:
						'Generate a concise PR title based on the following git diff. The title should be under 72 characters.',
					prompt: diff,
					maxRetries: 2,
				});
			} catch (error) {
				throw formatProviderError(error, baseUrl);
			}

			const title = titleResult.text;

			// Generate PR body
			let bodyResult;
			try {
				bodyResult = await generateText({
					model: aiProvider(config.model) as any,
					system:
						'Generate a concise PR description based on the following git diff. Format using Markdown with headings like ### Summary, ### Changes, ### Review Notes. Provide a high-level summary of the changes, what was implemented or fixed, and any specific details reviewers should consider. Avoid listing individual files.',
					prompt: diff,
					maxRetries: 2,
				});
			} catch (error) {
				throw formatProviderError(error, baseUrl);
			}

			const body = bodyResult.text;

			const endTime = Date.now();
			const duration = Math.round((endTime - startTime) / 1000);

			generating.stop(
				`Generated PR content for ${numFiles} files in ${duration}s`
			);

			console.log(`${green('Title:')} ${title.replace(/\n/g, ' ')}`);
			console.log(
				`${green('Body:')} ${
					body.length > 100 ? body.substring(0, 100) + '...' : body
				}`
			);

			const { text } = await import('@clack/prompts');
			const proceed = await text({
				message:
					'Press Enter to push and open PR creation in browser, or Ctrl+C to cancel',
				placeholder: 'Press Enter',
			});

			if (isCancel(proceed)) {
				outro('PR creation cancelled');
				return;
			}

			const pushing = spinner();
			pushing.start(`Pushing branch to ${provider}`);

			try {
				await execa('git', ['push', '-u', 'origin', currentBranch.trim()]);
				pushing.stop(`Branch pushed to ${provider}`);
			} catch (error) {
				pushing.stop('Failed to push branch');
				throw new KnownError(`Failed to push branch: ${error instanceof Error ? error.message : String(error)}`);
			}

			const prUrl = getPrUrl(
				provider,
				owner,
				repo,
				defaultBranch,
				currentBranch.trim(),
				title,
				body
			);

			const creating = spinner();
			creating.start('Opening PR creation page in browser');

			try {
				// Try to open browser
				const openCmd =
					process.platform === 'darwin'
						? 'open'
						: process.platform === 'win32'
						? 'start'
						: 'xdg-open';
				await execa(openCmd, [prUrl]);
				creating.stop('PR creation page opened in browser');
				outro(
					green('PR creation page opened! Please review and submit the PR.')
				);
			} catch (error) {
				creating.stop('Failed to open browser');
				outro(`${green('PR URL:')} ${prUrl}`);
				outro('Please open the URL above in your browser to create the PR.');
			}
		})().catch((error) => {
			handleCommandError(error);
		});
	}
);
