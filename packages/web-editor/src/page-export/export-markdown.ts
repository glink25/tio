import { pageAssetIds, pageMarkdown } from '@tio/serialization/page';
import { zip, strToU8 } from 'fflate';

import {
  contextFor,
  download,
  filename,
  prepareReferences,
  requiredAsset,
  type PageExportInput,
} from './shared';

export async function exportMarkdown(input: PageExportInput) {
  await prepareReferences(input);
  const name = filename(input.page.title || input.labels.untitled);
  const files: Record<string, Uint8Array> = {};
  const urls = new Map<string, string>();
  for (const id of pageAssetIds(input.page.blocks ?? [])) {
    const asset = await requiredAsset(input, id);
    const path = `assets/${id}-${filename(asset.name)}`;
    files[path] = asset.bytes;
    urls.set(id, path);
  }
  const markdown = pageMarkdown(
    { ...input.page, title: input.page.title || input.labels.untitled },
    contextFor(input, (id) => urls.get(id) ?? ''),
  );
  if (!urls.size) {
    download(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
    return;
  }
  files[`${name}.md`] = strToU8(markdown);
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (error, result) => (error ? reject(error) : resolve(result))),
  );
  download(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${name}.zip`);
}
