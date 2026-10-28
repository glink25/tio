import { prepareAsset } from '@tio/assets';
import { object, plainText, type Block, type TioObject, type AssetData } from '@tio/core';
import type { EditorSchema } from '@tio/editor-blocknote';
import { parseMarkdown } from '@tio/editor-blocknote/import-markdown';
import { unzip, type Unzipped } from 'fflate';

import { inspectArchive } from './archive';

function pathFor(path: string, base = ''): string {
  const parts = base.split('/').filter(Boolean);
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('Archive path escapes root');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
async function readArchive(bytes: Uint8Array) {
  inspectArchive(bytes);
  return new Promise<Unzipped>((resolve, reject) =>
    unzip(bytes, (error, files) => (error ? reject(error) : resolve(files))),
  );
}
const mimeFor = (name: string) =>
  ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
  })[name.split('.').pop()!.toLowerCase() as 'png'] ?? 'application/octet-stream';
export async function importMarkdown(
  file: File,
  workspaceId: string,
  parentId: string,
  schema?: EditorSchema,
) {
  const rawFiles = /\.zip$/i.test(file.name)
    ? await readArchive(new Uint8Array(await file.arrayBuffer()))
    : { [file.name]: new Uint8Array(await file.arrayBuffer()) };
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [name, bytes] of Object.entries(rawFiles)) {
    const path = pathFor(name);
    if (Object.hasOwn(files, path)) throw new Error('Duplicate archive path');
    files[path] = bytes;
  }
  const entries = Object.entries(files).filter(([name]) => /\.(md|markdown)$/i.test(name));
  if (!entries.length) throw new Error('No Markdown files');
  const pages = new Map<string, TioObject>(
    entries.map(([name]) => [
      pathFor(name),
      object('page', workspaceId, {
        parentId,
        order: Date.now(),
        title: name
          .split('/')
          .pop()!
          .replace(/\.(md|markdown)$/i, ''),
        blocks: [],
      }),
    ]),
  );
  const objects = [...pages.values()];
  const assets = new Map<string, AssetData>();
  const references = new Map<string, string>();
  for (const [name, bytes] of entries) {
    const page = pages.get(pathFor(name))!;
    const blocks = parseMarkdown(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
      schema,
    );
    const first = blocks[0];
    if (
      first?.type === 'heading' &&
      first.props.level === 1 &&
      plainText(first.content).trim() === page.title
    )
      blocks.shift();
    const base = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    const resolve = (url: string) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(url)) return;
      const path = pathFor(decodeURIComponent(url.split(/[?#]/)[0]), base);
      const target = pages.get(path);
      if (target) return target;
      if (!Object.hasOwn(files, path)) {
        if (/\.zip$/i.test(file.name)) throw new Error(`Missing archive file: ${path}`);
        return;
      }
      if (!references.has(path)) {
        const asset = prepareAsset(workspaceId, {
          name: path.split('/').pop()!,
          mime: mimeFor(path),
          bytes: files[path],
        });
        references.set(path, asset.ref);
        objects.push(asset.metadata);
        for (const [id, data] of asset.assets) assets.set(id, data);
      }
      return references.get(path);
    };
    const inline = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(inline);
      if (!value || typeof value !== 'object') return value;
      const item = value as Record<string, unknown>;
      if (item.type === 'link' && typeof item.href === 'string') {
        const target = resolve(item.href);
        if (target && typeof target !== 'string')
          return { type: 'mention', props: { workspaceId, kind: 'page', id: target.id } };
        if (typeof target === 'string')
          return { ...item, href: target, content: inline(item.content) };
      }
      return Object.fromEntries(Object.entries(item).map(([key, v]) => [key, inline(v)]));
    };
    const walk = (items: Block[]) =>
      items.forEach((block) => {
        if (typeof block.props.url === 'string') {
          const target = resolve(block.props.url);
          if (typeof target === 'string') block.props.url = target;
        }
        block.content = inline(block.content);
        walk(block.children);
      });
    walk(blocks);
    page.blocks = blocks;
  }
  return { objects, assets, firstId: pages.values().next().value!.id };
}
