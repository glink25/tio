import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { channels, decoded, productVersion } from './lib.mjs';
const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('Specify --out');
// Build numbers are shared by store tracks, so inspect both histories.
productVersion();
for (const track of ['stable', 'preview']) {
  await mkdir(join(values.out, track), { recursive: true });
  for (const channel of channels) {
    const response = await fetch(
      `https://raw.githubusercontent.com/glink25/tio/release-index/${track}/${channel}.json`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (response.status === 404) continue;
    if (!response.ok) throw new Error('Cannot read published baseline: ' + response.status);
    const envelope = await response.json();
    const value = decoded(envelope, process.env.TIO_RESOURCE_PUBLIC_KEY);
    if (value.kind !== 'release-index' || value.channel !== channel || value.track !== track)
      throw new Error('Baseline target mismatch');
    await writeFile(join(values.out, track, channel + '.json'), JSON.stringify(value));
  }
}
