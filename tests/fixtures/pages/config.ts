import { defineSite } from '@glink25/tio-pages';

export default defineSite({
  workspaceId: 'pages-test',
  assets: { 'theme.css': './style.css' },
  stylesheets: ['/theme.css'],
  code: { previews: ['html', 'mermaid'], defaultMode: 'split' },
  template: (objects, context) => ({
    routes: objects
      .filter((object) => object.type === 'page')
      .map((page) => ({
        path: page.id === 'modes' ? '/' : '/' + page.id,
        pageId: page.id,
        render: (site) =>
          `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${context.headHtml()}</head><body><main>${site.renderPage(page.id)}</main></body></html>`,
      })),
  }),
});
