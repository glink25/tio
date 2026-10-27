import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { MemoryProvider } from '@tio/provider-memory';
import { pathFor } from '@tio/serialization';
import { expect, it } from 'vitest';
const limit = 1024;
const setup = () => {
  const files = new MemoryProvider();
  return { files, content: new FileWorkspaceContent(files, 'w', { maxFileBytes: limit }) };
};
it('bounds JSON data and index files, preserving huge strings, Unicode and arbitrary subtrees', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', {
    id: 'p',
    blocks: [textBlock('中文👨‍👩‍👧‍👦\\\"\n'.repeat(500))],
    extra: Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => ['key' + i, { unknown: [i, true, null] }]),
    ),
  });
  await content.write(page);
  expect(files.files.size).toBeGreaterThan(20);
  expect([...files.files.values()].every((bytes) => bytes.length <= limit)).toBe(true);
  expect(await new FileWorkspaceContent(files, 'w', { maxFileBytes: limit }).read('p')).toEqual(
    page,
  );
});
it('publishes the head last, retains the previous object after a failed upload, and retries', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', { id: 'p', blocks: [] });
  await content.write(page);
  const next = { ...page, blocks: Array.from({ length: 30 }, (_, i) => textBlock('Text ' + i)) };
  let writes = 0;
  files.beforeWrite = async () => {
    if (++writes === 4) throw new Error('network failure');
  };
  await expect(content.write(next)).rejects.toThrow('network failure');
  expect(await content.read('p')).toEqual(page);
  files.beforeWrite = undefined;
  await content.write(next);
  expect(await content.read('p')).toEqual(next);
  const paths: string[] = [];
  files.beforeWrite = async (path) => {
    paths.push(path);
  };
  await content.write(next);
  expect(paths).toEqual([pathFor(next)]);
});
it('a head write failure never exposes an incomplete generation', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', { id: 'p', blocks: [] });
  await content.write(page);
  files.beforeWrite = async (path) => {
    if (path === pathFor(page)) throw new Error('head failure');
  };
  await expect(content.write({ ...page, blocks: [textBlock('new'.repeat(1000))] })).rejects.toThrow(
    'head failure',
  );
  expect(await content.read('p')).toEqual(page);
});
it('missing or corrupt chunks fail explicitly without falling back to stale content', async () => {
  const { files, content } = setup();
  await content.write(
    object('page', 'w', { id: 'p', blocks: [textBlock('content'.repeat(1000))] }),
  );
  const path = [...files.files.keys()].find((p) => p.includes('/chunks/'))!;
  const original = files.files.get(path)!;
  files.files.delete(path);
  await expect(content.read('p')).rejects.toThrow('Missing chunk');
  files.files.set(path, original.slice(0, -1));
  await expect(content.read('p')).rejects.toThrow('Invalid chunk');
});
it('reuses unchanged block chunks when editing a large document', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', {
    id: 'p',
    blocks: Array.from({ length: 100 }, (_, i) => ({ ...textBlock('Text ' + i), id: 'b' + i })),
  });
  await content.write(page);
  const initial = files.files.size;
  page.blocks![50].content = [{ type: 'text', text: 'changed', styles: {} }];
  await content.write(page);
  expect(files.files.size - initial).toBeLessThan(initial / 4);
  expect(await content.read('p')).toEqual(page);
});
