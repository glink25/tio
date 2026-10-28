import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface MermaidOptions {
  themes?: {
    light: 'default' | 'neutral' | 'dark' | 'forest';
    dark: 'default' | 'neutral' | 'dark' | 'forest';
  };
  executablePath?: string;
  args?: string[];
}
export interface DiagramImage {
  light: string;
  dark: string;
}

/** Mermaid uses a real browser only at build time. Exported diagrams are static SVG. */
export async function renderDiagrams(
  sources: string[],
  files: Map<string, Uint8Array>,
  directory: string,
  options: MermaidOptions = {},
) {
  const images = new Map<string, DiagramImage>();
  if (!sources.length) return images;
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    executablePath: options.executablePath,
    args: options.args,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({
      path: fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js')),
    });
    for (const source of new Set(sources)) {
      const image: DiagramImage = { light: '', dark: '' };
      for (const appearance of ['light', 'dark'] as const) {
        const theme = options.themes?.[appearance] ?? (appearance === 'dark' ? 'dark' : 'default');
        const hash = createHash('sha256')
          .update(JSON.stringify([source, theme]))
          .digest('hex')
          .slice(0, 24);
        const path = `${directory}/${hash}.svg`;
        if (!files.has(path)) {
          const svg = await page.evaluate(
            async ({ source, theme, hash }) => {
              const mermaid = (window as unknown as { mermaid: typeof import('mermaid').default })
                .mermaid;
              mermaid.initialize({
                startOnLoad: false,
                theme,
                securityLevel: 'strict',
                htmlLabels: false,
                fontFamily: 'sans-serif',
                deterministicIds: true,
                deterministicIDSeed: hash,
                suppressErrorRendering: true,
              });
              const id = 'diagram-' + hash;
              try {
                const holder = document.createElement('div');
                holder.innerHTML = (await mermaid.render(id, source)).svg;
                return new XMLSerializer().serializeToString(holder.querySelector('svg')!);
              } finally {
                document.getElementById(id)?.remove();
                document.getElementById('d' + id)?.remove();
              }
            },
            { source, theme, hash },
          );
          files.set(path, new TextEncoder().encode(svg));
        }
        image[appearance] = '/' + path;
      }
      images.set(source, image);
    }
  } finally {
    await browser.close();
  }
  return images;
}
