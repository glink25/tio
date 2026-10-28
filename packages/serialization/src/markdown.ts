import { titleOf, valueText, type Block, type TioObject } from '@tio/core';
import { strToU8, zipSync } from 'fflate';

import { markdownBlocks } from './page';
const escape = (value: string) => value.replace(/[\\`*_[\]<>|]/g, '\\$&');
/** A reading projection, deliberately separate from the lossless JSON backup format. */
export async function exportMarkdownZip(
  objects: TioObject[],
  getBlob: (id: string) => Promise<Uint8Array | undefined>,
): Promise<Uint8Array> {
  const live = objects.filter((o) => !o.deleted);
  const byId = new Map(live.map((o) => [o.id, o]));
  const files: Record<string, Uint8Array> = {};
  const label = (o: TioObject) => {
    if (o.type !== 'record') return titleOf(o);
    const db = byId.get(o.databaseId!);
    return valueText(o.properties?.[db?.fields?.find((f) => f.type === 'title')?.id ?? '']) || o.id;
  };
  const reference = (id: string) => {
    const target = byId.get(id);
    return target ? `[${escape(label(target))}](${id}.md)` : escape(id);
  };
  const blocks = (items: Block[]) =>
    markdownBlocks(items, {
      objects: byId,
      pageUrl: (id) => `${id}.md`,
      assetUrl: (id) => {
        const asset = byId.get(id);
        return asset?.assetPath ? `../${asset.assetPath}` : '';
      },
      unavailable: 'Unavailable reference',
      unsupported: 'Unsupported content',
    });
  for (const o of live) {
    if (o.type === 'asset') {
      const blob = await getBlob(o.id);
      if (!blob) throw new Error(`附件缺失：${o.filename}`);
      files[o.assetPath!] = blob;
    }
    if (!['page', 'database', 'record'].includes(o.type)) continue;
    let content = `# ${escape(label(o))}\n\n${blocks(o.blocks ?? [])}`;
    if (o.type === 'database') {
      const fields = o.fields ?? [];
      const row = (values: string[]) => `| ${values.join(' | ')} |`;
      content +=
        '\n\n' + row(fields.map((f) => escape(f.name))) + '\n' + row(fields.map(() => '---'));
      for (const record of live.filter((r) => r.type === 'record' && r.databaseId === o.id)) {
        content +=
          '\n' +
          row(
            fields.map((field) => {
              const value = record.properties?.[field.id];
              if (field.type === 'title') return reference(record.id);
              if (field.type === 'relation')
                return (Array.isArray(value) ? value : value ? [value] : [])
                  .map((id) => reference(valueText(id)))
                  .join(', ');
              if (field.options)
                return (Array.isArray(value) ? value : value == null ? [] : [value])
                  .map((id) =>
                    escape(
                      field.options!.find((option) => option.id === id)?.label ?? valueText(id),
                    ),
                  )
                  .join(', ');
              return escape(valueText(value)).replace(/\n/g, ' ');
            }),
          );
      }
    }
    const children = live
      .filter((child) => child.parentId === o.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (children.length)
      content += '\n\n' + children.map((child) => '- ' + reference(child.id)).join('\n');
    files[`documents/${o.id}.md`] = strToU8(content + '\n');
  }
  return zipSync(files);
}
