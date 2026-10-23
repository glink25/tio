import { object, textBlock } from '@tio/core';
import { exportMarkdownZip } from '@tio/serialization';
import { unzipSync, strFromU8 } from 'fflate';
import { it, expect } from 'vitest';
it('exports readable Markdown with stable links and portable attachments without changing source objects', async () => {
  const page = object('page', 'workspace', {
    id: 'parent',
    title: 'Parent',
    blocks: [
      textBlock('Text'),
      { id: 'link', type: 'pageReference', props: { pageId: 'child' }, content: [], children: [] },
      { id: 'image', type: 'image', props: { url: 'asset:picture' }, content: [], children: [] },
    ],
  });
  const child = object('page', 'workspace', {
    id: 'child',
    parentId: 'parent',
    title: 'Child',
    blocks: [],
  });
  const asset = object('asset', 'workspace', {
    id: 'picture',
    assetPath: 'assets/picture.png',
    filename: 'Picture',
    byteSize: 3,
    mime: 'image/png',
  });
  const originals = structuredClone([page, child, asset]);
  const archive = await exportMarkdownZip(originals, async () => new TextEncoder().encode('abc'));
  const files = unzipSync(archive);
  expect(strFromU8(files['documents/parent.md'])).toContain('[Child](child.md)');
  expect(strFromU8(files['documents/parent.md'])).toContain('![Picture](../assets/picture.png)');
  expect(strFromU8(files['assets/picture.png'])).toBe('abc');
  expect(originals).toEqual([page, child, asset]);
  await expect(exportMarkdownZip(originals, async () => undefined)).rejects.toThrow('附件缺失');
});
