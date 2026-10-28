import {
  codeText,
  githubMentionUrl,
  mentionTitle,
  isMentionReference,
  plainText,
  titleOf,
  valueText,
  type Block,
  type TioObject,
} from '@tio/core';

export interface PageExportContext {
  objects: ReadonlyMap<string, TioObject>;
  assetUrl(id: string): string;
  pageUrl?(id: string): string | undefined;
  unavailable: string;
  unsupported: string;
}
export const markdownEscape = (text: string) => text.replace(/[\\`*_[\]<>|~]/g, '\\$&');
export const exportUrl = (value: unknown): string => {
  const url = valueText(value).trim();
  return /^(https?:|mailto:|tel:)/i.test(url) &&
    !url.split('').some((char) => char.charCodeAt(0) <= 32 || char === '\\')
    ? url
    : '';
};
export const markdownUrl = (url: string) =>
  url.replace(/[\s()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function referenceLabel(value: unknown, context: PageExportContext): string {
  if (!isMentionReference(value)) return context.unavailable;
  return mentionTitle(value, [...context.objects.values()]) ?? context.unavailable;
}
export function staticBlockLabel(block: Block, context: PageExportContext): string | undefined {
  if (block.type === 'databaseView') {
    const db = context.objects.get(valueText(block.props.databaseId));
    return `[${db && !db.deleted && db.type === 'database' ? titleOf(db) : context.unavailable}]`;
  }
  if (block.type === 'appSlice') return `[App Slice: ${valueText(block.props.title)}]`;
  if (
    ![
      'paragraph',
      'heading',
      'quote',
      'codeBlock',
      'table',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'toggleListItem',
      'image',
      'file',
      'audio',
      'video',
    ].includes(block.type)
  )
    return `[${context.unsupported}: ${block.type}]`;
}
export function pageAssetIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const walk = (items: Block[]) =>
    items.forEach((b) => {
      if (
        ['image', 'file', 'audio', 'video'].includes(b.type) &&
        typeof b.props.url === 'string' &&
        b.props.url.startsWith('asset:')
      )
        ids.add(b.props.url.slice(6));
      walk(b.children);
    });
  walk(blocks);
  return [...ids];
}
export function markdownBlocks(blocks: Block[], context: PageExportContext): string {
  const inline = (value: unknown): string => {
    if (typeof value === 'string') return markdownEscape(value);
    if (Array.isArray(value)) return value.map(inline).join('');
    if (!value || typeof value !== 'object') return '';
    const node = value as Record<string, any>;
    if (node.type === 'mention') {
      const label = markdownEscape(referenceLabel(node.props, context));
      const target = isMentionReference(node.props)
        ? context.objects.get(node.props.id)
        : undefined;
      const url = isMentionReference(node.props)
        ? (githubMentionUrl(node.props) ??
          (target &&
          !target.deleted &&
          target.workspaceId === node.props.workspaceId &&
          target.type === node.props.kind
            ? context.pageUrl?.(target.id)
            : undefined))
        : undefined;
      return url ? `[${label}](${markdownUrl(url)})` : label;
    }
    if (node.type === 'link') {
      const label = inline(node.content);
      const url = exportUrl(node.href);
      return url ? `[${label}](${markdownUrl(url)})` : label;
    }
    if (node.type === 'tableCell') return inline(node.content);
    if (node.type !== 'text') return markdownEscape(context.unsupported);
    const text = valueText(node.text);
    const styles = node.styles ?? {};
    let result = markdownEscape(text);
    if (styles.code && text) {
      const fence = '`'.repeat(
        Math.max(1, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
      );
      result = `${fence} ${text.replace(/\n/g, ' ')} ${fence}`;
    }
    if (styles.bold && text.trim()) result = `**${result}**`;
    if (styles.italic && text.trim()) result = `*${result}*`;
    if (styles.strike && text.trim()) result = `~~${result}~~`;
    return result;
  };
  const render = (blocks: Block[]): string =>
    blocks
      .map((b) => {
        const text = inline(b.content);
        let result = staticBlockLabel(b, context) ?? text;
        if (b.type === 'databaseView') {
          const database = context.objects.get(valueText(b.props.databaseId));
          const url =
            database && !database.deleted && database.type === 'database'
              ? context.pageUrl?.(database.id)
              : undefined;
          if (url) result = `[${markdownEscape(titleOf(database!))}](${markdownUrl(url)})`;
        }
        let childIndent = '';
        switch (b.type) {
          case 'heading':
            result = `${'#'.repeat(Math.min(6, Math.max(1, Number(b.props.level) || 2)))} ${text}`;
            break;
          case 'paragraph':
            if (b.props.divider) result = '---';
            break;
          case 'bulletListItem':
          case 'toggleListItem':
            result = `- ${text}`;
            childIndent = '  ';
            break;
          case 'numberedListItem':
            result = `${Number(b.props.start) || 1}. ${text}`;
            childIndent = '   ';
            break;
          case 'checkListItem':
            result = `- [${b.props.checked ? 'x' : ' '}] ${text}`;
            childIndent = '  ';
            break;
          case 'quote':
            result = text
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
            break;
          case 'codeBlock': {
            const source = codeText(b.content);
            const fence = '`'.repeat(
              Math.max(3, ...Array.from(source.matchAll(/`+/g), (m) => m[0].length + 1)),
            );
            result = `${fence}${valueText(b.props.language).replace(/[^\w+.#-]/g, '')}\n${source}\n${fence}`;
            break;
          }
          case 'table': {
            const table = b.content as { rows?: { cells?: unknown[] }[] };
            const rows = (table.rows ?? []).map((row) =>
              (row.cells ?? []).map((cell) => inline(cell).replace(/\n/g, '<br>')),
            );
            const width = Math.max(0, ...rows.map((r) => r.length));
            result = rows
              .map(
                (r, i) =>
                  `| ${Array.from({ length: width }, (_, j) => r[j] ?? '').join(' | ')} |${i === 0 ? '\n| ' + Array(width).fill('---').join(' | ') + ' |' : ''}`,
              )
              .join('\n');
            break;
          }
          case 'image':
          case 'file':
          case 'audio':
          case 'video': {
            const ref = valueText(b.props.url);
            const asset = ref.startsWith('asset:') ? context.objects.get(ref.slice(6)) : undefined;
            const url = ref.startsWith('asset:') ? context.assetUrl(ref.slice(6)) : exportUrl(ref);
            const caption = markdownEscape(
              plainText(b.props.caption || b.props.name || asset?.filename || b.type),
            );
            result = url
              ? `${b.type === 'image' ? '!' : ''}[${caption}](${markdownUrl(url)})`
              : `[${caption}: ${context.unavailable}]`;
            break;
          }
        }
        const children = b.children.length
          ? '\n\n' +
            render(b.children)
              .split('\n')
              .map((line) => childIndent + line)
              .join('\n')
          : '';
        return result + children;
      })
      .join('\n\n');
  return render(blocks);
}
export function pageMarkdown(page: TioObject, context: PageExportContext): string {
  return `# ${markdownEscape(titleOf(page))}\n\n${markdownBlocks(page.blocks ?? [], context)}\n`;
}
