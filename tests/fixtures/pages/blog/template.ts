import { isMentionReference, plainText, valueText, type TioObject } from '@glink25/tio-pages';
import {
  escapeHtml as e,
  type PageRoute,
  type SiteContext,
  type SitePlan,
} from '@glink25/tio-pages';

export interface BlogOptions {
  workspaceId: string;
  title: string;
  description: string;
  siteUrl: string;
  pageSize: number;
  postParentId: string;
  pageMapId: string;
  tagsId: string;
  lang: string;
  pinTag: string;
  headHtml: string;
  headerHtml: string;
  footerHtml: string;
  giscus: Record<string, string> | false;
  fields: {
    post: string;
    tags: string;
    slug: string;
    draft: string;
    tagName: string;
  };
  slugify(title: string): string;
  routes: {
    post(slug: string): string;
    home(index: number): string;
    tagIndex: string;
    tag(tag: string, index: number): string;
  };
}

interface Post {
  page: TioObject;
  path: string;
  tags: string[];
  date: string;
  excerpt: string;
  cover?: string;
  updated: number;
}
export function blogPlan(
  objects: readonly TioObject[],
  config: BlogOptions,
  resources: { headHtml: () => string },
): SitePlan {
  if (!Number.isSafeInteger(config.pageSize) || config.pageSize < 1)
    throw new Error('Invalid page size');
  const live = objects.filter((o) => !o.deleted);
  const byId = new Map(live.map((o) => [o.id, o]));
  const posts: Post[] = [];
  for (const row of live.filter((o) => o.type === 'record' && o.databaseId === config.pageMapId)) {
    const props = row.properties ?? {};
    const postRef = props[config.fields.post];
    const customSlug = props[config.fields.slug];
    const relations = props[config.fields.tags];
    if (props[config.fields.draft] === true || postRef == null) continue;
    if (!isMentionReference(postRef)) throw new Error(`Invalid post mention: ${row.id}`);
    const page = byId.get(postRef.id);
    if (!page || page.deleted) continue;
    if (
      postRef.workspaceId !== config.workspaceId ||
      postRef.kind !== 'page' ||
      page.type !== 'page' ||
      page.parentId !== config.postParentId
    )
      throw new Error(`Invalid publication target: ${row.id}`);
    if (customSlug != null && typeof customSlug !== 'string')
      throw new Error(`Invalid publication slug: ${row.id}`);
    const slug =
      typeof customSlug === 'string' && customSlug.trim()
        ? customSlug.trim()
        : config.slugify(valueText(page.title));
    if (!slug) throw new Error(`Empty publication slug: ${row.id}`);
    const path = config.routes.post(slug);
    if (!Array.isArray(relations)) throw new Error(`Invalid tag relation: ${row.id}`);
    const tags = relations.map((id: string) => {
      const tag = byId.get(id);
      if (
        tag?.type !== 'record' ||
        tag.databaseId !== config.tagsId ||
        typeof tag.properties?.[config.fields.tagName] !== 'string'
      )
        throw new Error(`Invalid tag: ${id}`);
      return tag.properties[config.fields.tagName] as string;
    });
    const date = page.createdAt;
    if (!date || !Number.isFinite(Date.parse(date)))
      throw new Error(`Invalid publication date: ${row.id}`);
    const updated = page.updatedAt;
    if (!updated || !Number.isFinite(Date.parse(updated)))
      throw new Error(`Invalid article update date: ${row.id}`);
    posts.push({
      page,
      path: path,
      tags,
      date,
      updated: Date.parse(updated),
      excerpt: plainText(page.blocks?.find((b) => b.type === 'paragraph')?.content).slice(0, 300),
      cover: valueText(page.blocks?.find((b) => b.type === 'image')?.props.url),
    });
  }
  posts.sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date) || a.page.id.localeCompare(b.page.id),
  );
  const tagPath = (tag: string) => encodeURI(config.routes.tag(tag, 0));
  function layout(title: string, path: string, body: string, description = config.description) {
    return `<!doctype html><html lang="${e(config.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} | ${e(config.title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(new URL(encodeURI(path), config.siteUrl).href)}">${resources.headHtml()}${config.headHtml}</head><body>${config.headerHtml}${body}${config.footerHtml}</body></html>`;
  }
  const tagLinks = (tags: string[]) =>
    `<div class="tags">${tags.map((tag) => `<a href="${e(tagPath(tag))}">#${e(tag)}</a>`).join('')}</div>`;
  function card(post: Post, context: SiteContext) {
    const cover = post.cover?.startsWith('asset:')
      ? context.assetUrl(post.cover.slice(6))
      : undefined;
    return `<article class="post-card"><a class="post-preview" href="${e(encodeURI(post.path))}"><div><h2>${e(post.page.title)}</h2><p>${e(post.excerpt)}</p></div>${cover ? `<img src="${e(cover)}" alt="" loading="lazy">` : ''}</a>${tagLinks(post.tags)}<time datetime="${e(post.date)}">${e(post.date.slice(0, 10))}</time></article>`;
  }
  const routes: PageRoute[] = [];
  function listing(items: Post[], title: string, pathAt: (index: number) => string, home: boolean) {
    const pages = Math.max(1, Math.ceil(items.length / config.pageSize));
    for (let index = 0; index < pages; index++) {
      const path = pathAt(index);
      routes.push({
        path,
        render: (context) =>
          layout(
            title,
            path,
            `${home ? `<div class="brand">${e(config.title)}</div>` : ''}<main class="listing">${home ? '' : `<h1>${e(title)}</h1>`}${items
              .slice(index * config.pageSize, (index + 1) * config.pageSize)
              .map((post) => card(post, context))
              .join(
                '',
              )}<nav class="pagination" aria-label="Pagination">${Array.from({ length: pages }, (_, i) => `<a${i === index ? ' aria-current="page"' : ''} href="${e(encodeURI(pathAt(i)))}">${i + 1}</a>`).join('')}</nav></main>`,
          ),
      });
    }
  }
  // Match the original blog: create-time order is the stable base; only Pin posts use update time.
  const pinned = [...posts].sort((a, b) => {
    const aPinned = a.tags.includes(config.pinTag);
    const bPinned = b.tags.includes(config.pinTag);
    return Number(bPinned) - Number(aPinned) || (aPinned && bPinned ? b.updated - a.updated : 0);
  });
  listing(pinned, config.title, (index) => config.routes.home(index), true);
  const tags = [...new Set(posts.flatMap((post) => post.tags))].sort();
  for (const tag of tags)
    listing(
      posts.filter((post) => post.tags.includes(tag)),
      '#' + tag,
      (index) => config.routes.tag(tag, index),
      false,
    );
  routes.push({
    path: config.routes.tagIndex,
    render: () =>
      layout(
        'Tags',
        config.routes.tagIndex,
        `<main><h1>Tags</h1><div class="tag-cloud">${tags.map((tag) => `<a href="${e(tagPath(tag))}">#${e(tag)} <small>${posts.filter((post) => post.tags.includes(tag)).length}</small></a>`).join('')}</div></main>`,
      ),
  });
  posts.forEach((post, index) => {
    routes.push({
      path: post.path,
      pageId: post.page.id,
      render: (context) => {
        const navigation = [posts[index + 1], posts[index - 1]]
          .map((neighbor) =>
            neighbor
              ? `<a href="${e(encodeURI(neighbor.path))}">${e(neighbor.page.title)}</a>`
              : '<span></span>',
          )
          .join('');
        const comments = config.giscus
          ? `<section class="comments"><script src="https://giscus.app/client.js" ${Object.entries(
              config.giscus,
            )
              .map(([key, value]) => `${key}="${e(value)}"`)
              .join(' ')} crossorigin="anonymous" async></script></section>`
          : '';
        const blocks = post.page.blocks ?? [];
        const heading =
          blocks[0]?.type === 'heading' && plainText(blocks[0].content) === post.page.title
            ? ''
            : `<h1>${e(post.page.title)}</h1>`;
        return layout(
          post.page.title ?? '',
          post.path,
          `<main><article class="prose">${tagLinks(post.tags)}${heading}${context.renderPage(post.page.id)}<time datetime="${e(post.date)}">${e(post.date.slice(0, 10))}</time><nav class="neighbors">${navigation}</nav></article>${comments}</main>`,
          post.excerpt,
        );
      },
    });
  });
  return {
    routes,
    files: new Map([['.nojekyll', new Uint8Array()]]),
  };
}
