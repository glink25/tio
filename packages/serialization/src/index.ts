import { DomainError } from '@tio/core';
import { createDefaultRegistry, type ObjectRegistry, type TioObject } from '@tio/core';
import { zip, unzip, unzipSync, strToU8, type Unzipped } from 'fflate';
export function canonical(value: unknown): string {
  const normalize = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, normalize(v[k])]),
          )
        : v;
  return JSON.stringify(normalize(value), null, 2) + '\n';
}
export function encode(o: TioObject, types: ObjectRegistry = createDefaultRegistry()) {
  types.decode(o);
  return new TextEncoder().encode(canonical(o));
}
export function decode(bytes: Uint8Array, types: ObjectRegistry = createDefaultRegistry()) {
  return types.decode(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
export function pathFor(o: TioObject): string {
  return `workspaces/${o.workspaceId}/objects/${o.id}.json`;
}
export function managedPath(path: string, workspaceId?: string): boolean {
  const match = /^workspaces\/([a-zA-Z0-9_-]+)\/objects\/([a-zA-Z0-9_-]+)\.json$/.exec(path);
  return !!match && (workspaceId === undefined || match[1] === workspaceId);
}
export async function exportZip(
  objects: TioObject[],
  getBlob: (id: string) => Promise<Uint8Array | undefined>,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const o of objects) {
    files[pathFor(o)] = encode(o);
    if (o.type === 'asset') {
      const blob = await getBlob(o.id);
      if (!blob && !o.deleted) throw new Error(`附件缺失：${o.filename}`);
      if (blob) files[`workspaces/${o.workspaceId}/${o.assetPath}`] = blob;
    }
  }
  files['tio-export.json'] = strToU8(canonical({ format: 'tio', version: 1 }));
  return new Promise((resolve, reject) =>
    zip(files, (error, bytes) => (error ? reject(error) : resolve(bytes))),
  );
}
export async function importZip(bytes: Uint8Array): Promise<{
  objects: TioObject[];
  assets: Map<string, Uint8Array>;
}> {
  if (bytes.length < 22 || bytes.length > 100 * 1024 * 1024)
    throw new Error('Invalid archive size');
  const sizes = new Map<string, number>();
  let total = 0;
  // fflate's filter runs before allocation/inflation. A false-only pass reads the directory.
  unzipSync(bytes, {
    filter: (entry) => {
      if (
        sizes.has(entry.name) ||
        entry.name
          .split('/')
          .some(
            (part) =>
              !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
          )
      )
        throw new Error('Invalid or duplicate archive path');
      total += entry.originalSize;
      if (
        entry.originalSize > 100 * 1024 * 1024 ||
        total > 200 * 1024 * 1024 ||
        sizes.size >= 100_000
      )
        throw new Error('Archive exceeds extraction limits');
      sizes.set(entry.name, entry.originalSize);
      return false;
    },
  });
  if (!sizes.has('tio-export.json')) throw new Error('Missing archive format');
  const files = await new Promise<Unzipped>((resolve, reject) =>
    unzip(bytes, (error, files) => (error ? reject(error) : resolve(files))),
  );
  for (const [path, data] of Object.entries(files))
    if (data.length !== sizes.get(path)) throw new Error('Archive size mismatch');
  const format = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(files['tio-export.json']),
  );
  if (format.format !== 'tio' || format.version !== 1)
    throw new Error('Unsupported archive format');
  const objects = Object.entries(files)
    .filter(([p]) => managedPath(p))
    .map(([p, b]) => {
      const o = decode(b);
      if (pathFor(o) !== p) throw new DomainError('identity', '文件身份不匹配');
      return o;
    });
  if (objects.filter((o) => o.type === 'workspace').length !== 1)
    throw new DomainError('single-workspace', '请选择只包含一个工作空间的备份');
  const workspace = objects.find((o) => o.type === 'workspace')!;
  if (
    objects.some((o) => o.workspaceId !== workspace.id) ||
    new Set(objects.map((o) => o.id)).size !== objects.length
  )
    throw new DomainError('backup-identity', '备份对象重复或跨工作空间');
  const assets = new Map<string, Uint8Array>();
  for (const o of objects.filter((o) => o.type === 'asset')) {
    const b = files[`workspaces/${o.workspaceId}/${o.assetPath}`];
    if (b) assets.set(o.id, b);
    else if (!o.deleted) throw new Error(`附件缺失：${o.filename}`);
  }
  return { objects, assets };
}

export { exportMarkdownZip } from './markdown';
