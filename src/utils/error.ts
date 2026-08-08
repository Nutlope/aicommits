import { dim, red } from 'kolorist';
import pkg from '../../package.json';
const { version } = pkg;

export class KnownError extends Error {}

const getErrorChain = (error: unknown) => {
	const chain: unknown[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		chain.push(current);
		if (typeof current !== 'object') break;
		current = (current as Record<string, unknown>).cause;
	}
	return chain;
};

export const isModelUnavailableError = (error: unknown) => {
	const messages: string[] = [];
	for (const current of getErrorChain(error)) {
		if (current instanceof Error) messages.push(current.message.toLowerCase());
		if (typeof current !== 'object') continue;
		const errorRecord = current as Record<string, unknown>;
		if (errorRecord.status === 404 || errorRecord.statusCode === 404) return true;
	}

	const message = messages.join(' ');
	return (
		message.includes('unable to access') ||
		(message.includes('model') &&
			(message.includes('not found') ||
				message.includes('does not exist') ||
				message.includes('deprecated') ||
				message.includes('unavailable')))
	);
};

export const isToolUnsupportedError = (error: unknown) => {
	const messages: string[] = [];
	for (const current of getErrorChain(error)) {
		if (current instanceof Error) messages.push(current.message.toLowerCase());
		if (typeof current !== 'object') continue;
		const errorRecord = current as Record<string, unknown>;
		for (const key of ['responseBody', 'data']) {
			const value = errorRecord[key];
			if (typeof value === 'string') messages.push(value.toLowerCase());
		}
	}

	const message = messages.join(' ');
	const namesToolParameter =
		message.includes("'tools'") ||
		message.includes('"tools"') ||
		message.includes('tool_choice') ||
		message.includes('tool choice');
	const rejectsToolCalling =
		message.includes('does not support tools') ||
		message.includes("doesn't support tools") ||
		message.includes('tools are not supported') ||
		message.includes('tool calling is not supported') ||
		message.includes('does not support tool calling') ||
		message.includes('function calling is not supported') ||
		message.includes('does not support function calling');
	const rejectsToolParameter =
		namesToolParameter &&
		(message.includes('unsupported parameter') ||
			message.includes('invalid parameter') ||
			message.includes('unknown parameter') ||
			message.includes('not supported'));

	return rejectsToolCalling || rejectsToolParameter;
};

export const isInvalidJsonResponseError = (error: unknown) => {
	for (const current of getErrorChain(error)) {
		if (
			current instanceof Error &&
			current.message.toLowerCase().includes('invalid json response')
		) {
			return true;
		}
	}
	return false;
};

const indent = '    ';

/**
 * Extract diagnostic details from API-like errors (APICallError, etc.)
 * without leaking secrets. Returns a short summary for the user.
 */
const describeApiError = (error: unknown): string | null => {
	if (typeof error !== 'object' || error === null) return null;
	const record = error as Record<string, unknown>;
	const parts: string[] = [];

	if (typeof record.statusCode === 'number') {
		parts.push(`HTTP ${record.statusCode}`);
	}

	if (typeof record.responseBody === 'string') {
		const body = record.responseBody.trim();
		if (body.length === 0) {
			parts.push('empty response body');
		} else {
			try {
				const parsed = JSON.parse(body);
				// Extract error message from common API error shapes
				const errMsg =
					parsed?.error?.message ||
					parsed?.message ||
					(parsed?.error && typeof parsed.error === 'string'
						? parsed.error
						: null);
				if (errMsg) {
					parts.push(`API error: ${String(errMsg).slice(0, 200)}`);
				} else if (!parsed.choices) {
					// Response is valid JSON but missing expected fields
					const keys = Object.keys(parsed);
					parts.push(
						`unexpected response shape (keys: ${keys.join(', ').slice(0, 100)})`
					);
				}
			} catch {
				// Not JSON — show truncated preview (sanitize newlines)
				const preview = body.slice(0, 200).replace(/[\r\n]+/g, ' ');
				if (preview.length > 0) {
					parts.push(`non-JSON response: "${preview}"`);
				}
			}
		}
	}

	return parts.length > 0 ? ` (${parts.join('; ')})` : null;
};

export const handleCliError = (error: unknown) => {
	if (error instanceof Error && !(error instanceof KnownError)) {
		if (error.stack) {
			console.error(dim(error.stack.split('\n').slice(1).join('\n')));
		}
		const detail = describeApiError(error);
		if (detail) {
			console.error(`\n${indent}${dim(detail)}`);
		}
		console.error(`\n${indent}${dim(`aicommits v${version}`)}`);
		console.error(
			`\n${indent}Please open a Bug report with the information above:`
		);
		console.error(
			`${indent}https://github.com/Nutlope/aicommits/issues/new/choose`
		);
	}
};

export const handleCommandError = (error: unknown) => {
	process.stderr.write(`${red('✖')} ${(error as Error).message}\n`);
	handleCliError(error);
	process.exit(1);
};
