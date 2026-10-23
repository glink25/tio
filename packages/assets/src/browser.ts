import type { AssetData } from '@tio/core';
/** Browser presentation adapter; never used by the business core. */
export class AssetResolver {
  private urls = new Map<string, string>();
  private disposed = false;
  constructor(private store: { readAsset(id: string): Promise<AssetData | undefined> }) {}
  async resolve(ref: string) {
    if (!ref.startsWith('asset:')) return /^https?:\/\//.test(ref) ? ref : '';
    const id = ref.slice(6);
    if (this.urls.has(id)) return this.urls.get(id)!;
    const asset = await this.store.readAsset(id);
    if (!asset || this.disposed) return '';
    if (this.urls.has(id)) return this.urls.get(id)!;
    const url = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
    this.urls.set(id, url);
    return url;
  }
  dispose() {
    this.disposed = true;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
export async function fileData(file: File): Promise<AssetData> {
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}
