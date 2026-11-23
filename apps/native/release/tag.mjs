import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { git, productVersion } from './lib.mjs';
const { values } = parseArgs({ options: { plan: { type: 'string' }, push: { type: 'boolean' } } });
if (!values.plan)
  throw new Error('Usage: node apps/native/release/tag.mjs --plan <release-plan.json> [--push]');
if (git('status', '--porcelain')) throw new Error('Commit release configuration before tagging');
const plan = JSON.parse(await readFile(values.plan, 'utf8'));
const commit = git('rev-parse', 'HEAD');
const version = productVersion();
if (commit !== git('rev-parse', 'origin/main'))
  throw new Error('Release the exact fetched origin/main commit');
if (
  !Array.isArray(plan.include) ||
  !plan.include.length ||
  plan.include.some((p) => p.sourceCommit !== commit || p.version !== version)
)
  throw new Error('Plan does not describe this source commit');
const names = [
  'v' + version,
  ...plan.include
    .filter((p) => p.mode === 'host' && ['ios-store'].includes(p.channel))
    .map((p) => `host/${p.channel}/v${version}`),
];
for (const name of names) {
  const ref = 'refs/tags/' + name;
  if (
    git('for-each-ref', '--format=%(objectname)', ref) &&
    git('rev-parse', ref + '^{commit}') !== commit
  )
    throw new Error('Existing local tag points at another commit: ' + name);
  const remote = git('ls-remote', 'origin', ref);
  if (remote && remote.split(/\s+/)[0] !== commit)
    throw new Error('Existing remote tag differs: ' + name);
}
console.log(
  JSON.stringify({ sourceCommit: commit, tags: names, push: Boolean(values.push) }, null, 2),
);
if (values.push) {
  const checks = JSON.parse(
    execFileSync('gh', ['api', `repos/glink25/tio/commits/${commit}/check-runs`], {
      encoding: 'utf8',
    }),
  ).check_runs.filter((check) => check.name === 'quality');
  if (
    !checks.length ||
    checks.some((check) => check.status !== 'completed' || check.conclusion !== 'success')
  )
    throw new Error(
      'Wait for the main source commit quality checks before publishing release tags',
    );
  for (const name of names)
    if (!git('for-each-ref', '--format=%(objectname)', 'refs/tags/' + name))
      git('tag', name, commit);
  git('push', '--atomic', 'origin', ...names.map((name) => 'refs/tags/' + name));
}
