import { spawnSync } from 'node:child_process';
// Registry versions and integrity hashes are committed; CI never rewrites the dependency graph.
const result = spawnSync('corepack', ['pnpm', 'install', '--frozen-lockfile'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exitCode = result.status ?? 1;
