import { execa } from 'execa';

/**
 * Copy text to the system clipboard using native CLI tools.
 * macOS: pbcopy
 * Windows: clip
 * Linux: wl-copy (Wayland), xclip or xsel (X11)
 */
export async function copyToClipboard(message: string): Promise<boolean> {
	try {
		if (process.platform === 'darwin') {
			// macOS - use pbcopy
			await execa('pbcopy', { input: message });
		} else if (process.platform === 'win32') {
			// Windows - use clip
			await execa('clip', { input: message });
		} else {
			/**
			 * Linux:
			 * Ignore stdout/stderr to prevent the CLI from hanging while
			 * Linux clipboard tools fork background processes to serve the content.
			 */
			const options = {
				input: message,
				stdio: ['pipe', 'ignore', 'ignore'] as const,
			};

			try {
				// Try Wayland (wl-copy)
				await execa('wl-copy', options);
			} catch {
				try {
					// Fallback to xclip (X11)
					await execa('xclip', ['-selection', 'clipboard'], options);
				} catch {
					// Fallback to xsel (X11)
					await execa('xsel', ['--clipboard', '--input'], options);
				}
			}
		}
		return true;
	} catch {
		return false;
	}
}
