import {
  isMentionReference,
  plainText,
  titleOf,
  valueText,
  type Block,
  type TioObject,
} from '@tio/core';
import { strToU8, zipSync } from 'fflate';
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
  const inline = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(inline).join('');
    if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      if (node.type === 'mention' && isMentionReference(node.props)) {
        const target = byId.get(node.props.id);
        return target?.workspaceId === node.props.workspaceId && target.type === node.props.kind
          ? reference(target.id)
          : '[Unavailable reference]';
      }
      if (node.content) return inline(node.content);
    }
    return escape(plainText(value));
  };
  const blocks = (items: Block[], depth = 0): string =>
    items
      .map((b) => {
        const text = inline(b.content).trim();
        let result = text;
        switch (b.type) {
          case 'heading':
            result = `${'#'.repeat(Math.min(6, Math.max(1, Number(b.props.level) || 2)))} ${text}`;
            break;
          case 'bulletListItem':
            result = `- ${text}`;
            break;
          case 'numberedListItem':
            result = `1. ${text}`;
            break;
          case 'checkListItem':
            result = `- [${b.props.checked ? 'x' : ' '}] ${text}`;
            break;
          case 'quote':
            result = `> ${text}`;
            break;
          case 'codeBlock':
            result = plainText(b.content)
              .split('\n')
              .map((line) => `    ${line}`)
              .join('\n');
            break;
          case 'webSlice':
            result = `${escape(valueText(b.props.title))}\n\n${valueText(b.props.html)
              .split('\n')
              .map((line) => '    ' + line)
              .join('\n')}`;
            break;
          case 'databaseView':
            result = reference(valueText(b.props.databaseId));
            break;
          case 'image':
          case 'file':
          case 'video':
          case 'audio': {
            const ref = valueText(b.props.url);
            const asset = ref.startsWith('asset:') ? byId.get(ref.slice(6)) : undefined;
            const url = asset ? `../${asset.assetPath}` : /^https?:\/\//.test(ref) ? ref : '';
            result = url
              ? `${b.type === 'image' ? '!' : ''}[${escape(valueText(b.props.caption || asset?.filename || b.type))}](${encodeURI(url).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16))})`
              : text;
            break;
          }
          case 'table': {
            const content = b.content as { rows?: { cells?: unknown[] }[] };
            const rows =
              content?.rows?.map((row) => (row.cells ?? []).map((cell) => inline(cell).trim())) ??
              [];
            result = rows
              .map(
                (row, i) =>
                  `| ${row.join(' | ')} |${i === 0 ? '\n| ' + row.map(() => '---').join(' | ') + ' |' : ''}`,
              )
              .join('\n');
            break;
          }
        }
        const indent = '  '.repeat(depth);
        return indent + result + (b.children.length ? '\n' + blocks(b.children, depth + 1) : '');
      })
      .join('\n\n');
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
