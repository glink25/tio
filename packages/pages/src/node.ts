import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { FileWorkspaceContent } from '@tio/file-storage';
import { segments, type FileStorageProvider } from '@tio/storage';

import type { BuiltSite } from './page';

/** Node host adapter for the shared file format, including content-addressed chunks. */
export function folderContent(root: string, workspaceId: string): FileWorkspaceContent {
  root = resolve(root);
  const location = (path: string) => join(root, ...segments(path));
  const files: FileStorageProvider = {
    async list(prefix) {
      const base = location(prefix.replace(/\/$/, ''));
      try {
        const entries = await readdir(base, { recursive: true, withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => ({
            path: join(entry.parentPath, entry.name)
              .slice(resolve(root).length + 1)
              .split('\\')
              .join('/'),
          }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    async read(path) {
      try {
        return await readFile(location(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(path, bytes) {
      const file = location(path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async delete(path) {
      await rm(location(path), { force: true });
    },
  };
  return new FileWorkspaceContent(files, workspaceId);
}
/** Stage the complete build before replacing output; never expose a partially rendered site. */
export async function writeSite(site: BuiltSite, output: string) {
  const target = resolve(output);
  const staging = target + '.staging-' + crypto.randomUUID();
  await mkdir(staging, { recursive: true });
  try {
    for (const [path, bytes] of site.files) {
      const file = join(staging, ...segments(path));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    await rm(target, { force: true, recursive: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

/** Load trusted site code in place; templates outside the tool repo resolve its public API. */
export async function loadSiteConfig(file: string): Promise<import('./config').SiteConfiguration> {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    entryPoints: [resolve(file)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    alias: Object.fromEntries(
      ['', '/ssr', '/page', '/node', '/code'].map((suffix) => [
        '@glink25/tio-pages' + suffix,
        fileURLToPath(import.meta.resolve('@glink25/tio-pages' + suffix)),
      ]),
    ),
    nodePaths: [fileURLToPath(new URL('../node_modules', import.meta.url))],
  });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64')
  );
  return module.default;
}

export async function buildConfiguredSite(
  root: string,
  configFile = join(root, '.tio-page/config.ts'),
): Promise<BuiltSite> {
  const { buildSite } = await import('./page');
  const { escapeHtml, safeUrl } = await import('./ssr');
  const config = await loadSiteConfig(configFile);
  const directory = dirname(resolve(configFile));
  const content = folderContent(root, config.workspaceId);
  return buildSite(content, async (objects) => {
    const files = new Map<string, Uint8Array>();
    for (const [output, source] of Object.entries(config.assets ?? {})) {
      segments(output);
      files.set(output, await readFile(resolve(directory, source)));
    }
    for (const url of [...(config.stylesheets ?? []), ...(config.scripts ?? [])])
      if (!safeUrl(url)) throw new Error(`Invalid site resource URL: ${url}`);
    const styles = (config.stylesheets ?? []).map(
      (url) => `<link rel="stylesheet" href="${escapeHtml(safeUrl(url))}">`,
    );
    const scripts = [...(config.scripts ?? [])];
    const context = {
      workspaceId: config.workspaceId,
      headHtml: () =>
        styles.join('') +
        scripts
          .map((url) => `<script type="module" src="${escapeHtml(safeUrl(url))}"></script>`)
          .join(''),
    };
    const plan = await config.template([...objects.values()], context);
    for (const [path, bytes] of plan.files ?? []) {
      if (files.has(path)) throw new Error(`Duplicate output: ${path}`);
      files.set(path, bytes);
    }
    if (config.code) {
      const { createCodeRenderer } = await import('./code');
      const pages = new Set(plan.routes.map((route) => route.pageId));
      const code = await createCodeRenderer(
        [...objects.values()].filter((object) => pages.has(object.id)),
        config.code,
      );
      const custom = plan.renderBlock;
      plan.renderBlock = (block, renderContext) =>
        custom?.(block, renderContext) ?? code.renderBlock(block, renderContext);
      for (const [path, bytes] of code.files) {
        if (files.has(path)) throw new Error(`Duplicate output: ${path}`);
        files.set(path, bytes);
      }
    }
    return { ...plan, files };
  });
}

export async function buildSiteDirectory(root: string, output: string, configFile?: string) {
  root = resolve(root);
  output = resolve(output);
  const data = join(root, 'workspaces');
  const config = resolve(configFile ?? join(root, '.tio-page/config.ts'));
  if (
    root === output ||
    root.startsWith(output + '/') ||
    output === data ||
    output.startsWith(data + '/') ||
    config.startsWith(output + '/')
  )
    throw new Error('Output must not replace workspace data or site configuration');
  const site = await buildConfiguredSite(root, config);
  const manifest = new TextEncoder().encode(JSON.stringify(site.routes, null, 2) + '\n');
  if (site.files.has('routes.json')) throw new Error('Duplicate output: routes.json');
  site.files.set('routes.json', manifest);
  await writeSite(site, output);
  return site;
}
