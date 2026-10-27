import { DomainError } from '@tio/core';
import { id, object, type AssetData } from '@tio/core';
export function prepareAsset(workspaceId: string, file: AssetData) {
  if (file.bytes.byteLength > 20 * 1024 * 1024)
    throw new DomainError('asset-size', '附件不能超过 20 MB');
  const assetId = id('asset');
  const ext =
    file.name
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'bin';
  const metadata = object('asset', workspaceId, {
    id: assetId,
    filename: file.name,
    mime: file.mime || 'application/octet-stream',
    byteSize: file.bytes.byteLength,
    assetPath: `assets/${assetId}.${ext}`,
  });
  return { metadata, assets: new Map([[assetId, file]]), ref: `asset:${assetId}` };
}
