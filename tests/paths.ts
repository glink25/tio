import { fileURLToPath } from 'node:url';

export const testsRoot = fileURLToPath(new URL('.', import.meta.url));
export const repoRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
