import type { TioObject, WorkspaceContentPort } from '@tio/core';

import { renderBlocks, escapeHtml, safeUrl, type RenderContext } from './ssr';

/** A URL is a decoded site-root path; each route emits <path>/index.html. */
export function routeFile(path: string): string {
  for (const char of path) if (char.charCodeAt(0) < 32) throw new Error(`Invalid route: ${path}`);
  if (
    !path.startsWith('/') ||
    /[\\?#%]/.test(path) ||
    path.startsWith('//') ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(`Invalid route: ${path}`);
  return path.replace(/^\/+|\/+$/g, '') + (path === '/' ? 'index.html' : '/index.html');
}
export interface PageRoute {
  path: string;
  pageId?: string;
  render(context: SiteContext): string | Promise<string>;
}
export interface SiteContext extends RenderContext {
  renderPage(id: string): string;
}
export interface SitePlan {
  routes: PageRoute[];
  /** Files supplied by a trusted site template, e.g. CSS and JavaScript. */
  files?: ReadonlyMap<string, Uint8Array>;
  renderBlock?: RenderContext['renderBlock'];
}
export interface BuiltSite {
  files: Map<string, Uint8Array>;
  routes: string[];
}
/** Pure build: all reads use one workspace; no editor, DOM or persistence writes. */
export async function buildSite(
  content: WorkspaceContentPort,
  input: SitePlan | ((objects: ReadonlyMap<string, TioObject>) => SitePlan | Promise<SitePlan>),
): Promise<BuiltSite> {
  const objects = new Map<string, TioObject>();
  for (const id of await content.list()) {
    const object = await content.read(id);
    if (!object) throw new Error(`Missing object: ${id}`);
    objects.set(id, object);
  }
  const workspace = [...objects.values()].filter((o) => o.type === 'workspace' && !o.deleted);
  if (
    workspace.length !== 1 ||
    [...objects.values()].some((o) => o.workspaceId !== workspace[0].id)
  )
    throw new Error('Expected one workspace');
  const plan = typeof input === 'function' ? await input(objects) : input;
  const files = new Map<string, Uint8Array>(plan.files);
  const paths = new Set<string>();
  const urls = new Map<string, string>();
  for (const route of plan.routes) {
    const file = routeFile(route.path);
    if (paths.has(file) || files.has(file)) throw new Error(`Duplicate output: ${file}`);
    paths.add(file);
    if (route.pageId) {
      const page = objects.get(route.pageId);
      if (!page || page.deleted || page.type !== 'page')
        throw new Error(`Unavailable page: ${route.pageId}`);
      if (urls.has(page.id)) throw new Error(`Duplicate page route: ${page.id}`);
      urls.set(page.id, encodeURI(route.path));
    }
  }
  const assets = new Map<string, string>();
  for (const object of objects.values()) {
    if (object.type !== 'asset' || object.deleted) continue;
    const bytes = await content.readAsset(object);
    if (!bytes || bytes.byteLength !== object.byteSize)
      throw new Error(`Missing or invalid asset: ${object.id}`);
    const ext = String(object.assetPath)
      .split('.')
      .pop()!
      .replace(/[^a-zA-Z0-9]/g, '');
    const file = `assets/${object.id}.${ext || 'bin'}`;
    if (files.has(file) || paths.has(file)) throw new Error(`Duplicate output: ${file}`);
    files.set(file, bytes);
    assets.set(object.id, '/' + file);
  }
  const routeScripts = new Set<string>();
  const context: SiteContext = {
    objects,
    requireScript(url) {
      if (!safeUrl(url)) throw new Error(`Invalid runtime script: ${url}`);
      routeScripts.add(url);
    },
    pageUrl: (id) => urls.get(id),
    assetUrl: (id) => assets.get(id),
    renderBlock: plan.renderBlock,
    renderChildren: (blocks) => renderBlocks(blocks, context),
    renderPage(id) {
      const page = objects.get(id);
      if (!page || !urls.has(id)) throw new Error(`Unpublished page: ${id}`);
      return renderBlocks(page.blocks ?? [], context);
    },
  };
  for (const route of plan.routes) {
    routeScripts.clear();
    let html = await route.render(context);
    if (routeScripts.size) {
      const scripts = [...routeScripts]
        .map((url) => `<script type="module" src="${escapeHtml(url)}"></script>`)
        .join('');
      html = html.includes('</body>')
        ? html.replace('</body>', scripts + '</body>')
        : html + scripts;
    }
    files.set(routeFile(route.path), new TextEncoder().encode(html));
  }
  return { files, routes: plan.routes.map((route) => route.path) };
}
