export type StagedFile = {
	status: string;
	path: string;
	originalPath?: string;
};

// --name-status -z uses NUL between every field, including both rename paths.
export const parseStagedFiles = (output: string): StagedFile[] => {
	const fields = output.split('\0');
	const files: StagedFile[] = [];
	for (let index = 0; index < fields.length && fields[index];) {
		const status = fields[index++][0];
		const firstPath = fields[index++];
		if (status === 'R' || status === 'C') {
			files.push({ status, originalPath: firstPath, path: fields[index++] });
		} else {
			files.push({ status, path: firstPath });
		}
	}
	return files;
};

const statusSymbols: Record<string, string> = {
	A: '+',
	M: 'm',
	D: '-',
	R: 'r',
	C: 'c',
	T: 't',
	U: '!',
};

// Keep unusual filenames from inserting extra lines or terminal control codes.
const displayPath = (path: string) =>
	/[\x00-\x1f\x7f]/.test(path) ? JSON.stringify(path) : path;

export const formatStagedFile = (file: StagedFile) => {
	const path = file.originalPath
		? `${displayPath(file.originalPath)} → ${displayPath(file.path)}`
		: displayPath(file.path);
	return `[${statusSymbols[file.status] ?? '?'}] ${path}`;
};

export const formatStagedStatusSummary = (files: StagedFile[]) => {
	const counts = new Map<string, number>();
	for (const { status } of files) {
		const symbol = statusSymbols[status] ?? '?';
		counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
	}
	return ['+', 'm', '-', 'r', 'c', 't', '!', '?']
		.filter((symbol) => counts.has(symbol))
		.map((symbol) => `${symbol}${counts.get(symbol)}`)
		.join(' | ');
};
