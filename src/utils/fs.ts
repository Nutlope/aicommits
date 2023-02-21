import fs from 'fs/promises';

export const fileExists = (filePath: string) => fs.access(filePath).then(() => true, () => false);
