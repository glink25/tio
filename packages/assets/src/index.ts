import { id, object, type AssetData } from '@tio/core';
export function prepareAsset(workspaceId: string, file: AssetData) {
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
