import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { channels, signed } from '../release/lib.mjs';
const { values } = parseArgs({
  options: Object.fromEntries(
    ['channel', 'revision', 'translations', 'runtime-metadata', 'private-key', 'out'].map((k) => [
      k,
      { type: 'string' },
    ]),
  ),
});
if (!channels.includes(values.channel) || values.channel === 'web')
  throw new Error('Invalid content channel');
const revision = Number(values.revision);
if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid revision');
const meta = JSON.parse(await readFile(values['runtime-metadata'], 'utf8'));
if (meta.channel !== values.channel || !/^[a-f0-9]{64}$/.test(meta.runtimeId))
  throw new Error('Invalid runtime identity');
const translations = JSON.parse(await readFile(values.translations, 'utf8'));
if (!translations || Array.isArray(translations) || typeof translations !== 'object')
  throw new Error('Invalid translations');
for (const [language, entries] of Object.entries(translations)) {
  if (
    !meta.translationKeys[language] ||
    !entries ||
    Array.isArray(entries) ||
    typeof entries !== 'object'
  )
    throw new Error('Unknown language');
  for (const [key, value] of Object.entries(entries))
    if (!meta.translationKeys[language].includes(key) || typeof value !== 'string')
      throw new Error('Unknown translation key');
}
const payload = {
  format: 1,
  kind: 'translations',
  channel: values.channel,
  compatibleRuntimeIds: [meta.runtimeId],
  revision,
  translations,
};
await writeFile(
  values.out,
  JSON.stringify(
    values['private-key'] ? signed(payload, await readFile(values['private-key'])) : payload,
  ),
);
