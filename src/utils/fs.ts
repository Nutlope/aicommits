import fs from 'fs/promises';

// lstat is used because this is also used to check if a symlink file exists
export const fileExists = (filePath: string) =>
	fs.lstat(filePath).then(
		() => true,
		() => false
	);
