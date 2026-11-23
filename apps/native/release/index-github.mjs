import { readFile } from 'node:fs/promises';

import { signed, decoded, canonical, channels } from './lib.mjs';
export async function api(path, data, method = data ? 'POST' : 'GET') {
  const response = await fetch('https://api.github.com/repos/glink25/tio' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub ' + response.status + ' ' + path);
  return response.status === 204 ? null : response.json();
}
export async function changeIndex(track, channel, mutate) {
  if (!['stable', 'preview'].includes(track) || !channels.includes(channel))
    throw new Error('Invalid index target');
  const key = await readFile(process.env.TIO_RELEASE_KEY_FILE);
  for (let attempt = 0; attempt < 6; attempt++) {
    const ref = await api('/git/ref/heads/release-index');
    const head = ref ? await api('/git/commits/' + ref.object.sha) : null;
    const path = `${track}/${channel}.json`;
    const file = ref ? await api('/contents/' + path + '?ref=' + ref.object.sha) : null;
    const previous = file
      ? decoded(
          JSON.parse(Buffer.from(file.content, 'base64')),
          process.env.TIO_RESOURCE_PUBLIC_KEY,
        )
      : null;
    if (
      previous &&
      (previous.kind !== 'release-index' ||
        previous.track !== track ||
        previous.channel !== channel)
    )
      throw new Error('Index identity mismatch');
    const next = await mutate(previous);
    if (!next) return;
    next.revision = (previous?.revision ?? 0) + 1;
    if (previous && canonical({ ...next, revision: previous.revision }) === canonical(previous))
      return;
    const envelope = signed(next, key);
    decoded(envelope, process.env.TIO_RESOURCE_PUBLIC_KEY);
    const content = JSON.stringify(envelope) + '\n';
    if (Buffer.byteLength(content) > 2_000_000) throw new Error('Index exceeds client size limit');
    const tree = await api('/git/trees', {
      ...(head ? { base_tree: head.tree.sha } : {}),
      tree: [{ path, mode: '100644', type: 'blob', content }],
    });
    const commit = await api('/git/commits', {
      message: `Update ${track} ${channel} ${next.version}`,
      tree: tree.sha,
      parents: ref ? [ref.object.sha] : [],
    });
    try {
      if (ref)
        await api('/git/refs/heads/release-index', { sha: commit.sha, force: false }, 'PATCH');
      else await api('/git/refs', { ref: 'refs/heads/release-index', sha: commit.sha });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
    }
  }
}
