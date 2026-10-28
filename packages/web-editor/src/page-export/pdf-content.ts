import { codeText, plainText, valueText, type Block } from '@tio/core';
import {
  exportUrl,
  referenceLabel,
  staticBlockLabel,
  type PageExportContext,
} from '@tio/serialization/page';
import type { Content, ContentText, TableCell } from 'pdfmake/interfaces';

export function pdfInline(value: unknown, context: PageExportContext): ContentText[] {
  if (typeof value === 'string') return [{ text: value }];
  if (Array.isArray(value)) return value.flatMap((item) => pdfInline(item, context));
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, any>;
  if (node.type === 'mention') return [{ text: referenceLabel(node.props, context) }];
  if (node.type === 'tableCell') return pdfInline(node.content, context);
  if (node.type === 'link') {
    const url = exportUrl(node.href);
    return pdfInline(node.content, context).map((part) => ({
      ...part,
      ...(url ? { link: url, color: '#245b91', decoration: 'underline' as const } : {}),
    }));
  }
  if (node.type !== 'text') return [{ text: context.unsupported }];
  const styles = node.styles ?? {};
  const decoration: ('underline' | 'lineThrough')[] = [];
  if (styles.underline) decoration.push('underline');
  if (styles.strike) decoration.push('lineThrough');
  return [
    {
      text: valueText(node.text),
      ...(styles.bold ? { bold: true } : {}),
      ...(styles.italic ? { italics: true } : {}),
      decoration,
      ...(styles.code ? { background: '#eeeeee' } : {}),
    },
  ];
}

export interface ExportImage {
  data: string;
  width: number;
  height: number;
}

export function pdfBlocks(
  blocks: Block[],
  context: PageExportContext,
  images: ReadonlyMap<string, ExportImage>,
  depth = 0,
): Content[] {
  let number = 0;
  return blocks.flatMap((block): Content[] => {
    number = block.type === 'numberedListItem' ? Number(block.props.start) || number + 1 : 0;
    const text = pdfInline(block.content, context);
    const summary = staticBlockLabel(block, context);
    let content: Content = { text: summary ?? text, margin: [depth * 12, 0, 0, 8] };
    switch (block.type) {
      case 'heading':
        content = {
          text,
          fontSize: Math.max(12, 24 - (Number(block.props.level) || 2) * 2),
          bold: true,
          margin: [depth * 12, 10, 0, 8],
          headlineLevel: Number(block.props.level) || 2,
        };
        break;
      case 'paragraph':
        if (block.props.divider)
          content = {
            canvas: [{ type: 'line', x1: 0, y1: 4, x2: 499, y2: 4, lineColor: '#cccccc' }],
            margin: [0, 4, 0, 12],
          };
        break;
      case 'bulletListItem':
      case 'toggleListItem':
      case 'numberedListItem':
      case 'checkListItem': {
        const prefix =
          block.type === 'numberedListItem'
            ? `${number}. `
            : block.type === 'checkListItem'
              ? `[${block.props.checked ? 'x' : ' '}] `
              : '• ';
        content = { text: [{ text: prefix }, ...text], margin: [depth * 12, 0, 0, 6] };
        break;
      }
      case 'quote':
        content = { text, italics: true, color: '#555555', margin: [depth * 12 + 16, 0, 0, 8] };
        break;
      case 'codeBlock':
        content = {
          text: codeText(block.content).replace(/\t/g, '    '),
          fontSize: 9,
          background: '#f4f4f4',
          margin: [depth * 12, 4, 0, 10],
        };
        break;
      case 'table': {
        const table = block.content as { rows?: { cells?: unknown[] }[]; headerRows?: number };
        const rows = table.rows ?? [];
        const width = Math.max(0, ...rows.map((r) => r.cells?.length ?? 0));
        if (!width) {
          content = { text: '' };
          break;
        }
        const body: TableCell[][] = rows.map((row, rowIndex) =>
          Array.from({ length: width }, (_, index) => {
            const cell = row.cells?.[index];
            const props =
              cell && typeof cell === 'object' && !Array.isArray(cell)
                ? (cell as { props?: Record<string, number> }).props
                : undefined;
            return {
              text: pdfInline(cell, context),
              bold: rowIndex < (table.headerRows ?? 0),
              ...(props?.colspan ? { colSpan: props.colspan } : {}),
              ...(props?.rowspan ? { rowSpan: props.rowspan } : {}),
            };
          }),
        );
        content = {
          table: {
            headerRows: Math.min(table.headerRows ?? 0, rows.length),
            widths: Array(width).fill('*'),
            body,
          },
          layout: 'lightHorizontalLines',
          margin: [0, 4, 0, 12],
          fontSize: 9,
        };
        break;
      }
      case 'image':
      case 'file':
      case 'audio':
      case 'video': {
        const ref = valueText(block.props.url);
        const asset = ref.startsWith('asset:') ? context.objects.get(ref.slice(6)) : undefined;
        const caption = plainText(
          block.props.caption || block.props.name || asset?.filename || block.type,
        );
        const image = images.get(block.id);
        const url = exportUrl(ref);
        content = image
          ? {
              stack: [
                {
                  image: image.data,
                  fit: [Math.min(image.width, 499), Math.min(image.height, 620)],
                },
                { text: caption, fontSize: 9, color: '#555555' },
              ],
              margin: [0, 4, 0, 12],
            }
          : {
              text: `[${caption}${block.type === 'image' ? ': ' + context.unavailable : ''}]`,
              ...(url ? { link: url } : {}),
              margin: [0, 0, 0, 8],
            };
        break;
      }
    }
    return [content, ...pdfBlocks(block.children, context, images, depth + 1)];
  });
}
