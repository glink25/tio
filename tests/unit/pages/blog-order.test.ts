import { slug, type SiteContext } from '@glink25/tio-pages';
import { object, type TioObject } from '@tio/core';
import { executeCommand } from '@tio/workspace';
import { describe, expect, it } from 'vitest';

import { blogPlan, type BlogOptions } from '../../fixtures/pages/blog/template';

const config: BlogOptions = {
  workspaceId: 'blog',
  title: 'Blog',
  description: '',
  siteUrl: 'https://example.com',
  pageSize: 2,
  postParentId: 'posts',
  pageMapId: 'maps',
  tagsId: 'tags',
  lang: 'en',
  pinTag: 'Pin',
  headHtml: '',
  headerHtml: '',
  footerHtml: '',
  giscus: false,
  fields: {
    post: 'post',
    tags: 'tag',
    slug: 'slug',
    draft: 'draft',
    tagName: 'name',
  },
  slugify: (title) => slug(title, true),
  routes: {
    post: (slug) => '/post/' + slug,
    home: (index) => (index === 0 ? '/' : '/' + index),
    tagIndex: '/tag',
    tag: (tag, index) => '/tag/' + tag + (index ? '/' + index : ''),
  },
};
function fixture() {
  const objects = [
    object('record', 'blog', {
      id: 'pin',
      databaseId: 'tags',
      properties: { name: 'Pin' },
      blocks: [],
    }),
    object('record', 'blog', {
      id: 'all',
      databaseId: 'tags',
      properties: { name: 'All' },
      blocks: [],
    }),
  ];
  const post = (id: string, created: string, updated: string, pinned = false, draft = false) => {
    objects.push(
      object('page', 'blog', {
        id,
        title: id,
        parentId: 'posts',
        blocks: [],
        createdAt: new Date(created).toISOString(),
        updatedAt: new Date(updated).toISOString(),
      }),
    );
    objects.push(
      object('record', 'blog', {
        id: 'map_' + id,
        databaseId: 'maps',
        blocks: [],
        createdAt: '2026-10-28T00:00:00Z',
        updatedAt: '2026-10-28T00:00:00Z',
        properties: {
          post: { workspaceId: 'blog', kind: 'page', id },
          slug: id,
          tag: ['all', ...(pinned ? ['pin'] : [])],
          draft,
        },
      }),
    );
  };
  post('newest', '2026-10-01', '2026-10-01');
  post('old-edited', '2023-01-01', '2026-12-01');
  post('pin-new', '2025-10-01', '2025-10-01', true);
  post('pin-old', '2024-01-01', '2026-09-01', true);
  post('normal', '2025-06-01', '2025-06-01');
  post('draft', '2030-01-01', '2030-01-01', true, true);
  return objects;
}
async function render(objects: TioObject[], path: string) {
  const plan = blogPlan(objects, config, { headHtml: () => '' });
  const context: SiteContext = {
    objects: new Map(objects.map((o) => [o.id, o])),
    pageUrl: (id) => '/post/' + id,
    assetUrl: () => undefined,
    renderPage: () => '',
    renderChildren: () => '',
  };
  return plan.routes.find((route) => route.path === path)!.render(context);
}
const cards = (html: string) =>
  [...html.matchAll(/class="post-preview" href="([^"]+)"/g)].map((match) => match[1]);

describe('original blog ordering', () => {
  it('pins before pagination, orders pins by article update date and ordinary posts by creation date', async () => {
    const objects = fixture();
    expect(cards(await render(objects, '/'))).toEqual(['/post/pin-old', '/post/pin-new']);
    expect(cards(await render(objects, '/1'))).toEqual(['/post/newest', '/post/normal']);
    expect(cards(await render(objects, '/2'))).toEqual(['/post/old-edited']);
  });
  it('retains creation-time order for tags and adjacent posts, without pin priority', async () => {
    const objects = fixture();
    expect(cards(await render(objects, '/tag/Pin'))).toEqual(['/post/pin-new', '/post/pin-old']);
    expect(cards(await render(objects, '/tag/All'))).toEqual(['/post/newest', '/post/pin-new']);
    const article = await render(objects, '/post/pin-old');
    expect(article).toContain(
      '<nav class="neighbors"><a href="/post/old-edited">old-edited</a><a href="/post/normal">normal</a></nav>',
    );
  });
  it('responds to adding or removing the exact Pin relation and preserves creation order for tied pin updates', async () => {
    const objects = fixture();
    const mapping = (id: string) => objects.find((o) => o.id === 'map_' + id)!;
    mapping('pin-old').properties!.tag = ['all'];
    expect(cards(await render(objects, '/'))).toEqual(['/post/pin-new', '/post/newest']);
    mapping('normal').properties!.tag = ['all', 'pin'];
    objects.find((o) => o.id === 'normal')!.updatedAt = objects.find(
      (o) => o.id === 'pin-new',
    )!.updatedAt;
    expect(cards(await render(objects, '/'))).toEqual(['/post/pin-new', '/post/normal']);
  });
  it('editing a pinned page advances its rank without changing its mapping record', async () => {
    const original = fixture();
    const updated = executeCommand(
      {
        type: 'patch',
        id: 'pin-new',
        changes: { title: 'Edited pin' },
        timestamp: '2035-01-01T00:00:00Z',
      },
      original,
    );
    expect(updated.find((o) => o.id === 'map_pin-new')).toEqual(
      original.find((o) => o.id === 'map_pin-new'),
    );
    expect(cards(await render(updated, '/'))).toEqual(['/post/pin-new', '/post/pin-old']);
  });
  it('uses an optional explicit slug or generates it from the title with the configured algorithm', () => {
    const objects = fixture();
    const mapping = objects.find((o) => o.id === 'map_newest')!;
    const page = objects.find((o) => o.id === 'newest')!;
    page.title = '个人 WebDAV 接入Vooh手册！ Hello, World?';
    for (const value of [undefined, '', '   ']) {
      mapping.properties!.slug = value;
      const plan = blogPlan(objects, config, { headHtml: () => '' });
      expect(plan.routes.find((r) => r.pageId === page.id)?.path).toBe(
        '/post/个人-WebDAV-接入Vooh手册-Hello-World',
      );
    }
    mapping.properties!.slug = 'custom-Slug';
    expect(
      blogPlan(objects, config, { headHtml: () => '' }).routes.find((r) => r.pageId === page.id)
        ?.path,
    ).toBe('/post/custom-Slug');
    delete mapping.properties!.slug;
    const custom = {
      ...config,
      slugify: () => 'custom-algorithm',
      routes: { ...config.routes, post: (slug: string) => '/articles/' + slug },
    };
    expect(
      blogPlan(objects, custom, { headHtml: () => '' }).routes.find((r) => r.pageId === page.id)
        ?.path,
    ).toBe('/articles/custom-algorithm');
    page.title = '!!!';
    expect(() => blogPlan(objects, config, { headHtml: () => '' })).toThrow(
      'Empty publication slug',
    );
  });
  it('ignores incomplete mapping rows without a post reference', () => {
    const objects = fixture();
    const before = blogPlan(objects, config, { headHtml: () => '' }).routes.map((r) => r.path);
    objects.push(
      object('record', 'blog', {
        id: 'empty-map',
        databaseId: 'maps',
        properties: { title: 'Untitled' },
        blocks: [],
      }),
    );
    expect(blogPlan(objects, config, { headHtml: () => '' }).routes.map((r) => r.path)).toEqual(
      before,
    );
  });
  it('requires the page update date instead of sorting by mapping-record timestamps', () => {
    const objects = fixture();
    delete objects.find((o) => o.id === 'pin-old')!.updatedAt;
    expect(() => blogPlan(objects, config, { headHtml: () => '' })).toThrow(
      'Invalid article update date',
    );
  });
});
