import { spawnSync } from 'node:child_process';
import { readFile, mkdir, readdir, copyFile, lstat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';

import { root, hash, productVersion } from './lib.mjs';
const { values } = parseArgs({
  options: Object.fromEntries(
    ['plan', 'channel', 'out', 'input'].map((k) => [k, { type: 'string' }]),
  ),
});
const plan = JSON.parse(await readFile(values.plan, 'utf8')).include.find(
  (p) => p.channel === values.channel,
);
if (!plan) throw new Error('Target missing from plan');
await mkdir(values.out, { recursive: true });
function run(command, args) {
  const r = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  if (r.error || r.status !== 0) throw r.error ?? new Error(command + ' failed');
}
if (plan.mode === 'host' && !['ios-store'].includes(plan.channel)) {
  const source = values.input;
  const files = [];
  async function collect(directory, recursive = true) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Artifact links forbidden');
      const path = join(directory, entry.name);
      if (recursive && entry.isDirectory() && !entry.name.endsWith('.app')) await collect(path);
      else if (
        entry.isFile() &&
        entry.name !== 'runtime-source.tar.gz' &&
        /\.(exe|msi|dmg|deb|AppImage|tar\.gz|zip|aab|sig)$/.test(entry.name)
      )
        files.push(path);
    }
  }
  if (plan.channel === 'linux-direct') {
    // Tauri puts finished packages beside its AppImage build tree, which contains symlinks.
    for (const name of ['deb', 'appimage']) {
      const directory = join(source, name);
      if (!(await lstat(directory)).isDirectory())
        throw new Error('Expected a bundle directory: ' + name);
      await collect(directory, false);
    }
  } else {
    await collect(source);
  }
  if (!files.length) throw new Error('No native artifacts');
  const names = new Set();
  for (const file of files) {
    const name = basename(file);
    if (names.has(name)) throw new Error('Duplicate artifact filename');
    names.add(name);
    await copyFile(file, join(values.out, name));
  }
  if (['macos-direct', 'windows-direct', 'linux-direct'].includes(plan.channel)) {
    const signatures = files.filter(
      (f) =>
        f.endsWith('.sig') &&
        (plan.channel === 'windows-direct'
          ? f.endsWith('.exe.sig')
          : plan.channel === 'linux-direct'
            ? /\.AppImage(?:\.tar\.gz)?\.sig$/.test(f)
            : f.endsWith('.app.tar.gz.sig')),
    );
    if (signatures.length !== 1) throw new Error('Expected exactly one updater artifact');
    const targets = {
      'macos-direct': ['darwin-aarch64', 'darwin-x86_64'],
      'windows-direct': ['windows-x86_64'],
      'linux-direct': ['linux-x86_64'],
    }[plan.channel];
    const index = join(values.out, 'desktop-artifacts.json');
    await writeFile(
      index,
      JSON.stringify({
        version: productVersion(),
        channel: plan.channel,
        artifacts: targets.map((target) => ({
          target,
          file: basename(signatures[0]).slice(0, -4),
        })),
      }),
    );
    run('cargo', [
      'run',
      '--locked',
      '--manifest-path',
      'apps/native/release/Cargo.toml',
      '--',
      index,
      values.out,
    ]);
  }
}
const checksums = {};
for (const entry of await readdir(values.out, { withFileTypes: true }))
  if (entry.isFile() && entry.name !== 'receipt.json')
    checksums[entry.name] = hash(await readFile(join(values.out, entry.name)));
await writeFile(
  join(values.out, 'receipt.json'),
  JSON.stringify({ format: 1, ...plan, checksums }, null, 2),
);
