import { valueText, type Block } from '@tio/core';
import pdfMake from 'pdfmake/build/pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

import { pdfBlocks, type ExportImage } from './pdf-content';
import {
  contextFor,
  download,
  filename,
  prepareReferences,
  requiredAsset,
  type PageExportInput,
} from './shared';

const FONT = {
  regular:
    'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  bold: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf',
} as const;

async function imageData(blob: Blob): Promise<ExportImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportPDF(input: PageExportInput) {
  await prepareReferences(input);
  const images = new Map<string, ExportImage>();
  const cache = new Map<string, Promise<ExportImage | undefined>>();
  const loadImage = async (ref: string): Promise<ExportImage | undefined> => {
    if (ref.startsWith('asset:')) {
      const asset = await requiredAsset(input, ref.slice(6));
      try {
        return await imageData(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
      } catch {
        return undefined;
      }
    }
    if (!/^https?:\/\//i.test(ref)) return;
    try {
      const response = await fetch(ref, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return;
      return await imageData(await response.blob());
    } catch {
      return undefined;
    }
  };
  const walk = async (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === 'image') {
        const ref = valueText(block.props.url);
        if (!cache.has(ref)) cache.set(ref, loadImage(ref));
        const data = await cache.get(ref);
        if (data) images.set(block.id, data);
      }
      await walk(block.children);
    }
  };
  await walk(input.page.blocks ?? []);
  pdfMake.addFonts({
    Tio: {
      normal: FONT.regular,
      bold: FONT.bold,
      italics: FONT.regular,
      bolditalics: FONT.bold,
    },
  });
  const title = input.page.title || input.labels.untitled;
  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 48],
    info: { title, creator: 'Tio' },
    defaultStyle: { font: 'Tio', fontSize: 11, lineHeight: 1.3 },
    content: [
      { text: title, fontSize: 26, bold: true, margin: [0, 0, 0, 20] },
      ...pdfBlocks(
        input.page.blocks ?? [],
        contextFor(input, () => ''),
        images,
      ),
    ],
    footer: (page, count) => ({
      text: `${page} / ${count}`,
      alignment: 'center',
      fontSize: 9,
      color: '#777777',
      margin: [0, 16, 0, 0],
    }),
    pageBreakBefore: (node, container) =>
      !!node.headlineLevel && !container.getFollowingNodesOnPage().length,
  };
  const blob = await pdfMake.createPdf(definition).getBlob();
  download(blob, `${filename(title)}.pdf`);
}
