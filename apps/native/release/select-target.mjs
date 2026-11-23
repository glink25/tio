import { readFile, writeFile } from 'node:fs/promises';
const [source, output] = process.argv.slice(2);
const expected = JSON.parse(process.env.TIO_TARGET);
const full = JSON.parse(await readFile(source, 'utf8')).include.find(
  (row) => row.channel === expected.channel,
);
if (
  !full ||
  full.sourceCommit !== expected.sourceCommit ||
  full.version !== expected.version ||
  full.mode !== expected.mode ||
  full.revision !== expected.revision
)
  throw new Error('Workflow plan mismatch');
await writeFile(output, JSON.stringify({ include: [full] }));
