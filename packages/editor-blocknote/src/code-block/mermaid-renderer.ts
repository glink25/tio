import mermaid from 'mermaid';

// Mermaid configuration is global. Serialize configure+render as a single job so
// independently themed editors cannot change configuration during another render.
let queue: Promise<unknown> = Promise.resolve();
export function renderDiagram(source: string, theme: 'light' | 'dark'): Promise<string> {
  const result = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      suppressErrorRendering: true,
    });
    const id = 'tio-mermaid-' + crypto.randomUUID();
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById('d' + id)?.remove();
    }
  });
  queue = result.catch(() => undefined);
  return result;
}
