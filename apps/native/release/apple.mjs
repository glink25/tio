import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { apple, list } from './apple-api.mjs';
const { values } = parseArgs({
  options: Object.fromEntries(['plan', 'channel', 'out'].map((k) => [k, { type: 'string' }])),
});
const plan = JSON.parse(await readFile(values.plan, 'utf8')).include.find(
  (p) => p.channel === values.channel,
);
if (!plan || plan.mode !== 'host' || !['ios-store', 'macos-direct'].includes(plan.channel))
  throw new Error('Invalid Apple host plan');
const refs = await list(
  `/v1/scmRepositories/${process.env.ASC_SCM_REPOSITORY_ID}/gitReferences?limit=200`,
);
const reference = refs.find(
  (r) => r.attributes.canonicalName === 'refs/tags/v' + plan.version && !r.attributes.isDeleted,
);
if (!reference) throw new Error('Release tag has not reached Xcode Cloud');
const workflow =
  plan.channel === 'ios-store'
    ? process.env.ASC_IOS_WORKFLOW_ID
    : process.env.ASC_MACOS_WORKFLOW_ID;
if (!workflow) throw new Error('Configure the platform Xcode Cloud workflow');
const view = await fetch(
  'https://api.github.com/repos/glink25/tio/releases/tags/' + encodeURIComponent(plan.distTag),
  {
    headers: {
      Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
    },
  },
);
if (view.status === 404)
  execFileSync(
    'gh',
    [
      'release',
      'create',
      plan.distTag,
      '--repo',
      'glink25/tio',
      '--target',
      plan.sourceCommit,
      '--title',
      `Tio ${plan.version} · ${plan.channel}`,
      '--draft',
    ],
    { stdio: 'inherit' },
  );
else if (!view.ok || !(await view.json()).draft)
  throw new Error('Expected unpublished Cloud artifact release');
const runs = await list(`/v1/ciWorkflows/${workflow}/buildRuns?limit=200`);
let run = runs.find(
  (r) =>
    r.attributes.sourceCommit?.commitSha === plan.sourceCommit &&
    (r.attributes.completionStatus === 'SUCCEEDED' || !r.attributes.completionStatus),
);
if (!run)
  run = (
    await apple('/v1/ciBuildRuns', {
      data: {
        type: 'ciBuildRuns',
        attributes: { clean: true },
        relationships: {
          workflow: { data: { type: 'ciWorkflows', id: workflow } },
          sourceBranchOrTag: { data: { type: 'scmGitReferences', id: reference.id } },
        },
      },
    })
  ).data;
await mkdir(values.out, { recursive: true });
await writeFile(
  join(values.out, 'cloud-run.json'),
  JSON.stringify({ runId: run.id, sourceCommit: plan.sourceCommit, channel: plan.channel }),
);
const deadline = Date.now() + 4 * 60 * 60 * 1000;
while (run.attributes.executionProgress !== 'COMPLETE') {
  if (Date.now() > deadline)
    throw new Error('Xcode Cloud timeout; inspect cloud-run.json before retrying');
  if (['SUCCEEDED', 'FAILED', 'ERRORED', 'CANCELED'].includes(run.attributes.completionStatus))
    break;
  await new Promise((r) => setTimeout(r, 30000));
  run = (await apple('/v1/ciBuildRuns/' + run.id)).data;
}
if (
  run.attributes.completionStatus !== 'SUCCEEDED' ||
  run.attributes.sourceCommit?.commitSha !== plan.sourceCommit
)
  throw new Error('Cloud build failed or used another commit');
execFileSync(
  'gh',
  ['release', 'download', plan.distTag, '--repo', 'glink25/tio', '--dir', values.out],
  { stdio: 'inherit' },
);
const receipt = JSON.parse(await readFile(join(values.out, 'apple-build.json'), 'utf8'));
if (
  receipt.sourceCommit !== plan.sourceCommit ||
  receipt.version !== plan.version ||
  receipt.build !== plan.hostBuild ||
  receipt.channel !== plan.channel ||
  String(receipt.buildNumber) !== String(run.attributes.number)
)
  throw new Error('Apple artifact receipt mismatch');
