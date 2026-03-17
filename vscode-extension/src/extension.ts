import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

let outputChannel: vscode.OutputChannel;
const TIMEOUT_MS = 15000;
let cliInstalled = false;
const PACKAGE_NAME = 'aicommits';

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('AI Commits');
	outputChannel.appendLine('[Extension] Activating AI Commits extension...');

	const generateCommand = vscode.commands.registerCommand(
		'aicommits.generate',
		() => {
			const config = vscode.workspace.getConfiguration('aicommits');
			const defaultType = config.get<
				'plain' | 'conventional' | 'gitmoji' | 'subject+body'
			>('defaultType', 'plain');
			return generateCommitMessage(defaultType);
		},
	);

	const generateConventionalCommand = vscode.commands.registerCommand(
		'aicommits.generateConventional',
		() => generateCommitMessage('conventional'),
	);

	const generateGitmojiCommand = vscode.commands.registerCommand(
		'aicommits.generateGitmoji',
		() => generateCommitMessage('gitmoji'),
	);

	const generateSubjectBodyCommand = vscode.commands.registerCommand(
		'aicommits.generateSubjectBody',
		() => generateCommitMessage('subject+body'),
	);

	const setupCommand = vscode.commands.registerCommand('aicommits.setup', () =>
		openSetupTerminal(),
	);

	const selectModelCommand = vscode.commands.registerCommand(
		'aicommits.selectModel',
		() => openTerminal('aicommits model'),
	);

	context.subscriptions.push(
		generateCommand,
		generateConventionalCommand,
		generateGitmojiCommand,
		generateSubjectBodyCommand,
		setupCommand,
		selectModelCommand,
		outputChannel,
	);

	checkCliOnActivation();
}

async function checkCliOnActivation() {
	outputChannel.appendLine('[Activation] Checking CLI installation...');
	cliInstalled = await isCliInstalled();
	outputChannel.appendLine(`[Activation] CLI installed: ${cliInstalled}`);

	if (!cliInstalled) {
		const action = await vscode.window.showInformationMessage(
			'AI Commits requires aicommits CLI. Install it now?',
			'Install',
			'Later',
		);

		if (action === 'Install') {
			await installCli();
		}
	} else {
		checkForCliUpdate();
	}
}

async function getCliVersion(): Promise<string | null> {
	try {
		const { stdout } = await execAsync('aicommits --version');
		const version = stdout.trim().replace(/^v/, '');
		outputChannel.appendLine(`[CLI] Detected version: ${version}`);
		return version;
	} catch (error) {
		outputChannel.appendLine(`[CLI] Failed to get version: ${error}`);
		return null;
	}
}

async function fetchLatestVersion(distTag: string): Promise<string | null> {
	const url = `https://registry.npmjs.org/${PACKAGE_NAME}/${distTag}`;
	outputChannel.appendLine(`[NPM] Fetching: ${url}`);
	try {
		const response = await fetch(url, {
			headers: { Accept: 'application/json' },
		});
		outputChannel.appendLine(`[NPM] Response status: ${response.status}`);
		if (!response.ok) return null;
		const data = (await response.json()) as { version?: string };
		outputChannel.appendLine(`[NPM] Got version: ${data.version}`);
		return data.version || null;
	} catch (error) {
		outputChannel.appendLine(`[NPM] Fetch failed: ${error}`);
		return null;
	}
}

function parseVersion(version: string) {
	const match = version.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.(\d+))?)/,
	);
	if (!match)
		return {
			major: 0,
			minor: 0,
			patch: 0,
			prerelease: null as string | null,
			prereleaseNum: 0,
		};
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: parseInt(match[3], 10),
		prerelease: match[4] || null,
		prereleaseNum: match[5] ? parseInt(match[5], 10) : 0,
	};
}

function compareVersions(v1: string, v2: string): number {
	const p1 = parseVersion(v1);
	const p2 = parseVersion(v2);
	if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
	if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
	if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
	if (!p1.prerelease && p2.prerelease) return 1;
	if (p1.prerelease && !p2.prerelease) return -1;
	if (!p1.prerelease && !p2.prerelease) return 0;
	if (p1.prereleaseNum !== p2.prereleaseNum)
		return p1.prereleaseNum > p2.prereleaseNum ? 1 : -1;
	return 0;
}

async function checkForCliUpdate(): Promise<void> {
	outputChannel.appendLine('[Update Check] Starting...');

	const currentVersion = await getCliVersion();
	outputChannel.appendLine(
		`[Update Check] Current version: ${currentVersion || 'not found'}`,
	);
	if (!currentVersion) return;

	const distTag = currentVersion.includes('-') ? 'develop' : 'latest';
	outputChannel.appendLine(`[Update Check] Using dist-tag: ${distTag}`);

	const latestVersion = await fetchLatestVersion(distTag);
	outputChannel.appendLine(
		`[Update Check] Latest version: ${latestVersion || 'not found'}`,
	);
	if (!latestVersion) return;

	const comparison = compareVersions(currentVersion, latestVersion);
	outputChannel.appendLine(
		`[Update Check] Version comparison result: ${comparison}`,
	);

	if (comparison >= 0) {
		outputChannel.appendLine('[Update Check] No update needed');
		return;
	}

	outputChannel.appendLine(
		`[Update Check] Update available! Showing notification...`,
	);

	const action = await vscode.window.showInformationMessage(
		`A new version of aicommits CLI is available (v${latestVersion}). Update now?`,
		'Update',
		'Later',
	);

	outputChannel.appendLine(
		`[Update Check] User action: ${action || 'dismissed'}`,
	);

	if (action === 'Update') {
		const terminal = vscode.window.createTerminal({
			name: 'AI Commits Update',
		});
		terminal.show();
		terminal.sendText(`npm install -g ${PACKAGE_NAME}@${distTag}`);
		vscode.window.showInformationMessage('Updating aicommits CLI...');
	}
}

async function isCliInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('which', ['aicommits'], { shell: true });
		let output = '';
		proc.stdout.on('data', (data) => {
			output += data.toString();
		});
		proc.on('close', (code) => {
			outputChannel.appendLine(
				`[CLI Check] which aicommits exit code: ${code}, output: ${output.trim()}`,
			);
			resolve(code === 0);
		});
		proc.on('error', (err) => {
			outputChannel.appendLine(`[CLI Check] Error: ${err}`);
			resolve(false);
		});
	});
}

async function installCli(): Promise<boolean> {
	return new Promise((resolve) => {
		const terminal = vscode.window.createTerminal({ name: 'AI Commits Setup' });
		terminal.show();
		terminal.sendText('npm install -g aicommits && aicommits setup');

		vscode.window.showInformationMessage(
			'Installing aicommits... Complete the setup in the terminal, then try again.',
			'OK',
		);

		resolve(false);
	});
}

async function ensureCliInstalled(): Promise<boolean> {
	if (cliInstalled) {
		return true;
	}

	cliInstalled = await isCliInstalled();
	if (cliInstalled) {
		return true;
	}

	const action = await vscode.window.showErrorMessage(
		'aicommits CLI is not installed. Install it now?',
		'Install',
		'Cancel',
	);

	if (action === 'Install') {
		await installCli();
	}
	return false;
}

async function generateCommitMessage(
	type: 'plain' | 'conventional' | 'gitmoji' | 'subject+body',
) {
	if (!(await ensureCliInstalled())) {
		return;
	}

	const config = vscode.workspace.getConfiguration('aicommits');
	const cliPath = config.get<string>('path', 'aicommits');
	const autoCommit = config.get<boolean>('autoCommit', false);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace folder open');
		return;
	}

	const cwd = workspaceFolders[0].uri.fsPath;

	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	const git = gitExtension?.getAPI(1);
	const repo = git?.repositories[0];

	if (!repo) {
		vscode.window.showErrorMessage('No Git repository found');
		return;
	}

	const originalMessage = repo.inputBox.value;
	repo.inputBox.value = '⏳ Generating commit message...';

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.SourceControl,
			title: 'Generating commit message...',
			cancellable: false,
		},
		async () => {
			try {
				const args = [];
				if (type !== 'plain') {
					args.push('--type', type);
				}

				const message = await runCli(cliPath, args, cwd, TIMEOUT_MS);

				if (!message) {
					repo.inputBox.value = originalMessage;
					vscode.window.showWarningMessage('No message generated');
					return;
				}

				if (autoCommit) {
					await commitWithMessage(repo, message);
				} else {
					repo.inputBox.value = message;
					vscode.window.showInformationMessage('✨ Commit message generated!');
				}
			} catch (error) {
				repo.inputBox.value = originalMessage;
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				if (errorMessage.includes('Timeout')) {
					vscode.window
						.showWarningMessage(
							'⏱️ AI is taking too long. Try again or check your API key.',
							'Setup',
							'Cancel',
						)
						.then((action) => {
							if (action === 'Setup') {
								openSetupTerminal();
							}
						});
				} else {
					outputChannel.appendLine(`Error: ${errorMessage}`);
					vscode.window.showErrorMessage(`AI Commits error: ${errorMessage}`);
				}
			}
		},
	);
}

function openSetupTerminal() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const cwd = workspaceFolders?.[0]?.uri.fsPath;

	const terminal = vscode.window.createTerminal({
		name: 'AI Commits Setup',
		cwd,
	});

	terminal.show();
	terminal.sendText('aicommits setup');
}

function openTerminal(command: string) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const cwd = workspaceFolders?.[0]?.uri.fsPath;

	const terminal = vscode.window.createTerminal({
		name: 'AI Commits',
		cwd,
	});

	terminal.show();
	terminal.sendText(command);
}

function runCli(
	cliPath: string,
	args: string[],
	cwd: string,
	timeout: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		outputChannel.appendLine(`Running: ${cliPath} ${args.join(' ')}`);

		const proc = spawn(cliPath, args, {
			cwd,
			shell: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		proc.stderr.on('data', (data) => {
			stderr += data.toString();
			outputChannel.append(data.toString());
		});

		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error('Timeout'));
		}, timeout);

		proc.on('close', (code) => {
			clearTimeout(timer);

			if (code !== 0) {
				reject(new Error(stderr || `Process exited with code ${code}`));
				return;
			}

			resolve(stdout.trim());
		});

		proc.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

async function commitWithMessage(repo: any, message: string) {
	try {
		await repo.commit(message);
		vscode.window.showInformationMessage('✅ Committed successfully!');
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to commit: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function deactivate() {}
