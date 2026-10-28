import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function auditPagesOutput(root) {
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const js = files.filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
  assert(js.length <= 1, 'Only the HTML iframe initializer may be shipped as JavaScript');
  const report = {
    pages: 0,
    staticPages: 0,
    htmlPreviewPages: 0,
    javascriptFiles: js.length,
    javascriptBytes: 0,
    mermaidSvgFiles: 0,
    thirdPartyScriptReferences: 0,
  };
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (entry.name.endsWith('.js')) {
      const code = await readFile(path, 'utf8');
      assert.equal(path, join(root, 'tio-code/client.js'));
      assert(
        !/import\s*\(|mermaid|shiki|BlockNote|React|react-dom|prosemirror|indexedDB|WorkspaceRuntime/i.test(
          code,
        ),
        path,
      );
      report.javascriptBytes += Buffer.byteLength(code);
    }
    if (entry.name.endsWith('.svg') && path.includes('/tio-code/')) {
      const svg = await readFile(path, 'utf8');
      assert(svg.startsWith('<svg') && !/<script\b|\bon\w+=/i.test(svg), path);
      report.mermaidSvgFiles++;
    }
    if (!entry.name.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');
    const allScripts = [...html.matchAll(/<script\b([^>]*)>/g)];
    const scripts = allScripts.filter((script) => !/src=["']https?:\/\//i.test(script[1]));
    report.thirdPartyScriptReferences += allScripts.length - scripts.length;
    const hasHtmlPreview = html.includes('data-code-preview="html"');
    assert.equal(scripts.length, hasHtmlPreview ? 1 : 0, path);
    for (const script of scripts) assert(script[1].includes('src="/tio-code/client.js"'), path);
    assert(
      !/<[a-z][^>]*\s(?:contenteditable|data-block-container|data-node-type|data-tio-[\w-]*)=/i.test(
        html,
      ),
      path,
    );
    assert(!html.includes('data-code-source'), 'Source should not be serialized twice');
    report.pages++;
    if (hasHtmlPreview) report.htmlPreviewPages++;
    else report.staticPages++;
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const root = resolve(process.argv[2]);
  const report = await auditPagesOutput(root);
  if (process.argv[3])
    await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n');
  console.log(report);
}
