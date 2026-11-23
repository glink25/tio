import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: Object.fromEntries(
    ['plan', 'channel', 'out', 'input'].map((k) => [k, { type: 'string' }]),
  ),
});
const plan = JSON.parse(await readFile(values.plan, 'utf8')).include.find(
  (p) => p.channel === values.channel,
);
if (!plan) throw new Error('Missing target plan');
await mkdir(values.out, { recursive: true });
function run(args) {
  const r = spawnSync('node', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(args[0] + ' failed');
}
if (plan.mode === 'web') {
  const result = spawnSync(
    'tar',
    ['-czf', join(values.out, 'web.tar.gz'), '-C', 'apps/web/dist', '.'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Web archive failed');
}
if (plan.mode === 'runtime' || plan.mode === 'host')
  run([
    'apps/native/updates/frontend-pack.mjs',
    '--channel',
    plan.channel,
    '--dir',
    `apps/native/dist/${plan.channel === 'ios-store' ? 'ios' : plan.channel.startsWith('android-') ? 'android' : 'desktop'}`,
    '--revision',
    String(plan.revision),
    '--out',
    values.out,
  ]);
if (plan.mode === 'content') {
  if (!plan.content?.translations) throw new Error('Declare the content translation JSON');
  const metadata = join(values.out, 'content-runtime.json');
  await writeFile(metadata, JSON.stringify(plan.previous.runtime));
  run([
    'apps/native/updates/resource-pack.mjs',
    '--channel',
    plan.channel,
    '--revision',
    String(plan.revision),
    '--translations',
    plan.content.translations,
    '--runtime-metadata',
    metadata,
    '--out',
    join(values.out, 'content-payload.json'),
  ]);
}
run([
  'apps/native/release/assemble.mjs',
  '--plan',
  values.plan,
  '--channel',
  plan.channel,
  '--out',
  values.out,
  ...(values.input ? ['--input', values.input] : []),
]);
