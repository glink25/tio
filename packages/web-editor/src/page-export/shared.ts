import { blockMentions, DomainError, type AssetData, type Block, type TioObject } from '@tio/core';
import type { PageExportContext } from '@tio/serialization/page';

export interface PageExportInput {
  page: TioObject;
  objects: TioObject[];
  readAsset(id: string): Promise<AssetData | undefined>;
  readMetadata(ids: string[]): Promise<TioObject[]>;
  labels: { untitled: string; unavailable: string; unsupported: string };
}
/** Read only referenced metadata; export never loads the whole space. */
export async function prepareReferences(input: PageExportInput) {
  const ids = new Set(
    blockMentions(input.page.blocks ?? [])
      .filter((reference) => reference.workspaceId === input.page.workspaceId)
      .map((reference) => reference.id),
  );
  const walk = (blocks: Block[]) =>
    blocks.forEach((block) => {
      if (block.type === 'databaseView' && typeof block.props.databaseId === 'string')
        ids.add(block.props.databaseId);
      if (
        ['image', 'file', 'audio', 'video'].includes(block.type) &&
        typeof block.props.url === 'string' &&
        block.props.url.startsWith('asset:')
      )
        ids.add(block.props.url.slice(6));
      walk(block.children);
    });
  walk(input.page.blocks ?? []);
  const known = new Set(input.objects.map((object) => object.id));
  const missing = [...ids].filter((id) => !known.has(id));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    input.objects.push(...(await input.readMetadata(missing.slice(offset, offset + 1000))));
  }
}
export function contextFor(
  input: PageExportInput,
  assetUrl: PageExportContext['assetUrl'],
): PageExportContext {
  return {
    objects: new Map(
      input.objects
        .filter((o) => !o.deleted && o.workspaceId === input.page.workspaceId)
        .map((o) => [o.id, o]),
    ),
    assetUrl,
    ...input.labels,
  };
}
export function filename(title: string): string {
  return (
    title
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .replace(/[. ]+$/g, '')
      .slice(0, 120) || 'Untitled'
  );
}
export async function requiredAsset(input: PageExportInput, id: string): Promise<AssetData> {
  const asset = await input.readAsset(id);
  if (!asset) throw new DomainError('asset-missing');
  return asset;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
