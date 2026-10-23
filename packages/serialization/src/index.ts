import { validate, registry, type TioObject } from '@tio/core';
import { zipSync, unzipSync, strToU8 } from 'fflate';
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
export function encode(o: TioObject) {
  validate(o);
  return new TextEncoder().encode(canonical(o));
}
export function decode(bytes: Uint8Array) {
  return registry().decode(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
export function pathFor(o: TioObject): string {
  const root = `workspaces/${o.workspaceId}/`;
  switch (o.type) {
    case 'workspace':
      return root + 'workspace.json';
    case 'page':
      return root + `pages/${o.id}.json`;
    case 'database':
      return root + `databases/${o.id}/schema.json`;
    case 'record':
      return root + `databases/${o.databaseId}/records/${o.id}.json`;
    case 'databaseView':
      return root + `databases/${o.databaseId}/views/${o.id}.json`;
    case 'asset':
      return root + `assets/${o.id}.json`;
    default:
      return root + `objects/${o.id}.json`;
  }
}
export function managedPath(path: string, workspaceId?: string): boolean {
  const root = workspaceId ? `workspaces/${workspaceId}/` : 'workspaces/[a-zA-Z0-9_-]+/';
  return new RegExp(
    `^${root}(workspace\\.json|pages/[a-zA-Z0-9_-]+\\.json|objects/[a-zA-Z0-9_-]+\\.json|assets/[a-zA-Z0-9_-]+\\.json|databases/[a-zA-Z0-9_-]+/(schema\\.json|(records|views)/[a-zA-Z0-9_-]+\\.json))$`,
  ).test(path);
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
  return zipSync(files);
}
export function importZip(bytes: Uint8Array): {
  objects: TioObject[];
  assets: Map<string, Uint8Array>;
} {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('备份文件不能超过 100 MB');
  const files = unzipSync(bytes, { filter: (f) => f.originalSize <= 100 * 1024 * 1024 });
  if (Object.values(files).reduce((n, x) => n + x.length, 0) > 200 * 1024 * 1024)
    throw new Error('解压内容过大');
  const objects = Object.entries(files)
    .filter(([p]) => managedPath(p))
    .map(([p, b]) => {
      const o = decode(b);
      if (pathFor(o) !== p) throw new Error('文件身份不匹配');
      return o;
    });
  if (objects.filter((o) => o.type === 'workspace').length !== 1)
    throw new Error('请选择只包含一个工作空间的备份');
  const workspace = objects.find((o) => o.type === 'workspace')!;
  if (
    objects.some((o) => o.workspaceId !== workspace.id) ||
    new Set(objects.map((o) => o.id)).size !== objects.length
  )
    throw new Error('备份对象重复或跨工作空间');
  const assets = new Map<string, Uint8Array>();
  for (const o of objects.filter((o) => o.type === 'asset')) {
    const b = files[`workspaces/${o.workspaceId}/${o.assetPath}`];
    if (b) assets.set(o.id, b);
    else if (!o.deleted) throw new Error(`附件缺失：${o.filename}`);
  }
  return { objects, assets };
}

export { exportMarkdownZip } from './markdown';
