import { readFile, writeFile } from 'node:fs/promises';

import { googleToken } from './google-api.mjs';
import { readJSON, hash } from './lib.mjs';
const [bundle, out] = process.argv.slice(2);
const access_token = await googleToken('https://www.googleapis.com/auth/androidpublisher');
const base =
  'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.glink25.tio';
async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('Play ' + response.status + ' ' + path);
  return response.json();
}
const edit = await api('/edits', {});
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const bytes = await readFile(bundle);
const existing = (await api(`/edits/${edit.id}/bundles`)).bundles?.find(
  (b) => b.versionCode === metadata.buildNumber,
);
let uploaded = existing;
if (existing) {
  if (existing.sha256 !== hash(bytes))
    throw new Error('Play build number already contains another binary');
} else {
  const response = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/com.glink25.tio/edits/${edit.id}/bundles?uploadType=media`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + access_token,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
      signal: AbortSignal.timeout(180000),
    },
  );
  if (!response.ok) throw new Error('Play bundle upload failed: ' + response.status);
  uploaded = await response.json();
}
if (uploaded.versionCode !== metadata.buildNumber || uploaded.sha256 !== hash(bytes))
  throw new Error('Play uploaded bundle differs from the release');
const track = metadata.version.includes('-rc.') ? 'internal' : 'production';
await api(
  `/edits/${edit.id}/tracks/${track}`,
  {
    track,
    releases: [
      {
        name: metadata.version,
        versionCodes: [String(uploaded.versionCode)],
        status: 'completed',
        releaseNotes: Object.entries(
          readJSON('apps/native/release-plan.json').storeNotes['android-play'],
        ).map(([language, text]) => ({ language, text })),
      },
    ],
  },
  'PUT',
);
await api(`/edits/${edit.id}:commit?changesNotSentForReview=false`, {});
// A completed track configuration is not evidence of completed store review.
await writeFile(
  out,
  JSON.stringify(
    {
      format: 1,
      channel: 'android-play',
      version: metadata.version,
      build: uploaded.versionCode,
      track,
      status: 'processing',
      editId: edit.id,
    },
    null,
    2,
  ),
);
