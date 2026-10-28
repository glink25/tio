import {
  codeText,
  valueText,
  isMentionReference,
  plainText,
  titleOf,
  type Block,
  type TioObject,
} from '@tio/core';

export const escapeHtml = (value: unknown): string =>
  valueText(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Only allow navigation/media URLs, never executable or protocol-relative URLs. */
export function safeUrl(value: unknown): string {
  const url = valueText(value).trim();
  for (const char of url) if (char.charCodeAt(0) <= 32 || char === '\\') return '';
  return url.startsWith('//') || !/^(https?:|mailto:|tel:|\/|#)/i.test(url) ? '' : url;
}
export interface RenderContext {
  objects: ReadonlyMap<string, TioObject>;
  pageUrl(id: string): string | undefined;
  assetUrl(id: string): string | undefined;
  renderChildren(blocks: Block[]): string;
  requireScript?(url: string): void;
  /** Trusted renderer extensions return HTML; unknown blocks fail the build by default. */
  renderBlock?(block: Block, context: RenderContext): string | undefined;
}
export function renderInline(value: unknown, context: RenderContext): string {
  if (typeof value === 'string') return escapeHtml(value).replace(/\n/g, '<br>');
  if (Array.isArray(value)) return value.map((item) => renderInline(item, context)).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (node.type === 'mention' && isMentionReference(node.props)) {
    const target = context.objects.get(node.props.id);
    const url =
      target &&
      !target.deleted &&
      target.workspaceId === node.props.workspaceId &&
      target.type === node.props.kind
        ? context.pageUrl(target.id)
        : undefined;
    return url
      ? `<a href="${escapeHtml(safeUrl(url))}">${escapeHtml(titleOf(target!))}</a>`
      : '<span>[Unavailable reference]</span>';
  }
  if (node.type === 'link') {
    const content = renderInline(node.content, context);
    const url = safeUrl(node.href);
    return url ? `<a href="${escapeHtml(url)}">${content}</a>` : content;
  }
  if (node.type === 'text') {
    let result = renderInline(valueText(node.text), context);
    const styles = (node.styles ?? {}) as Record<string, unknown>;
    for (const [style, tag] of Object.entries({
      bold: 'strong',
      italic: 'em',
      underline: 'u',
      strike: 's',
      code: 'code',
    }))
      if (styles[style]) result = `<${tag}>${result}</${tag}>`;
    return result;
  }
  if (node.type === 'tableCell') return renderInline(node.content, context);
  throw new Error(`Unsupported inline content: ${String(node.type)}`);
}
export function renderBlocks(blocks: Block[], context: RenderContext): string {
  let html = '';
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const custom = context.renderBlock?.(block, context);
    if (custom !== undefined) {
      html += custom;
      continue;
    }
    const anchor = escapeHtml(valueText(block.props.anchor ?? block.id));
    const inner = () => renderInline(block.content, context);
    const children = () => renderBlocks(block.children, context);
    if (['bulletListItem', 'numberedListItem', 'checkListItem'].includes(block.type)) {
      const type = block.type;
      const tag = type === 'numberedListItem' ? 'ol' : 'ul';
      html += `<${tag}${tag === 'ol' ? ` start="${Number(block.props.start) || 1}"` : ''}>`;
      let item = block;
      while (true) {
        html += `<li id="${escapeHtml(item.id)}">${type === 'checkListItem' ? `<input type="checkbox" disabled${item.props.checked ? ' checked' : ''}> ` : ''}${renderInline(item.content, context)}${renderBlocks(item.children, context)}</li>`;
        if (blocks[index + 1]?.type !== type) break;
        item = blocks[++index];
      }
      html += `</${tag}>`;
      continue;
    }
    switch (block.type) {
      case 'paragraph':
        html += block.props.divider ? '<hr>' : `<p id="${anchor}">${inner()}</p>${children()}`;
        break;
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(block.props.level) || 2));
        html += `<h${level} id="${anchor}">${inner()}</h${level}>${children()}`;
        break;
      }
      case 'quote':
        html += `<blockquote id="${anchor}">${inner()}${children()}</blockquote>`;
        break;
      case 'codeBlock':
        html += `<pre id="${anchor}"><code class="language-${escapeHtml(valueText(block.props.language).replace(/[^\w+-]/g, ''))}">${escapeHtml(codeText(block.content))}</code></pre>${children()}`;
        break;
      case 'table': {
        const table = block.content as { rows: { cells: unknown[] }[]; headerRows?: number };
        html += `<div class="table-scroll"><table>${table.rows
          .map(
            (row, i) =>
              `<tr>${row.cells
                .map((cell) => {
                  const tag = i < (table.headerRows ?? 0) ? 'th' : 'td';
                  return `<${tag}>${renderInline(cell, context)}</${tag}>`;
                })
                .join('')}</tr>`,
          )
          .join('')}</table></div>`;
        break;
      }
      case 'image':
      case 'file':
      case 'video':
      case 'audio': {
        const ref = valueText(block.props.url);
        const url = ref.startsWith('asset:') ? context.assetUrl(ref.slice(6)) : safeUrl(ref);
        if (!url) throw new Error(`Missing or unsafe media: ${block.id}`);
        const caption = escapeHtml(plainText(block.props.caption ?? block.props.name ?? ''));
        const src = escapeHtml(safeUrl(url));
        html +=
          block.type === 'image'
            ? `<figure id="${anchor}"><img src="${src}" alt="${caption}" loading="lazy">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`
            : block.type === 'file'
              ? `<p><a href="${src}" download>${caption || 'Download'}</a></p>`
              : `<${block.type} src="${src}" controls></${block.type}>`;
        html += children();
        break;
      }
      default:
        throw new Error(`Unsupported block: ${block.type} (${block.id})`);
    }
  }
  return html;
}
