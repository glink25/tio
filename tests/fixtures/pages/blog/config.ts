import { defineSite, slug } from '@glink25/tio-pages';

import { blogPlan, type BlogOptions } from './template';

/** Trusted site configuration. HTML hooks may include your own scripts and templates. */
const blog: BlogOptions = {
  workspaceId: 'glink-blog',
  title: 'Link AI',
  description: 'A self-owned full-static blog system',
  siteUrl: 'https://glink25.github.io',
  pageSize: 10,
  postParentId: 'post',
  pageMapId: 'PageMap',
  tagsId: 'Tags',
  lang: 'zh-CN',
  pinTag: 'Pin',
  fields: {
    post: 'post',
    tags: 'tag',
    slug: 'slug',
    draft: 'draft',
    tagName: 'name',
  },
  // Match the original blog: GitHub slugging while preserving letter case.
  slugify: (title) => slug(title, true),
  routes: {
    post: (slug) => '/post/' + slug,
    home: (index) => (index === 0 ? '/' : '/' + index),
    tagIndex: '/tag',
    tag: (tag, index) => '/tag/' + tag + (index === 0 ? '' : '/' + index),
  },
  headHtml:
    '<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="144x144" href="/favicon.png">',
  headerHtml:
    '<header><a href="/" class="home-icon" aria-label="Homepage"><svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 18V20H5V18H16ZM21 11V13H3V11H21ZM19 4V6H8V4H19Z"/></svg></a><a href="/tag">Tags</a></header>',
  footerHtml:
    '<footer><nav aria-label="Footer"><a href="/tag">Tags</a><a href="https://github.com/glink25" target="_blank" rel="noopener noreferrer">About</a><details class="footer-tools"><summary>Tools</summary><div class="tool-links"><a href="https://oncent.github.io" target="_blank" rel="noopener noreferrer">Oncent - 多人记账PWA，无需服务器</a><a href="https://peek-transfer.github.io" target="_blank" rel="noopener noreferrer">Peek - 点对点快速传输文件</a><a href="https://glink25.gitee.io" target="_blank" rel="noopener noreferrer">My Days - 倒数日</a></div></details></nav><a href="https://github.com/glink25">© Glink</a></footer>',
  giscus: {
    'data-repo': 'glink25/glink25.github.io',
    'data-repo-id': 'R_kgDONTJ_KQ',
    'data-category': 'Announcements',
    'data-category-id': 'DIC_kwDONTJ_Kc4Ckrg6',
    'data-mapping': 'pathname',
    'data-strict': '0',
    'data-reactions-enabled': '1',
    'data-emit-metadata': '0',
    'data-input-position': 'bottom',
    'data-theme': 'preferred_color_scheme',
    'data-lang': 'zh-CN',
  },
};

export default defineSite({
  workspaceId: blog.workspaceId,
  assets: {
    'blog.css': './style.css',
    'favicon.ico': './favicon.ico',
    'favicon.png': './favicon.png',
  },
  stylesheets: ['/blog.css'],
  scripts: [],
  code: {
    themes: { light: 'light-plus', dark: 'dark-plus' },
    defaultMode: 'preview',
    previews: ['html', 'mermaid'],
    labels: {
      code: '代码',
      preview: '预览',
      split: '分屏',
      displayMode: '显示模式',
      htmlPreview: 'HTML 预览',
    },
  },
  template: (objects, context) => blogPlan(objects, blog, context),
});
