# @glink25/tio-pages

可独立发布到 npm 的只读静态发布包，消费当前 Tio 工作空间。个人模板、CSS、脚本、路由和数据库映射属于工作空间，包中不包含个人站点或特定博客模型。

```text
my-workspace/
├── workspaces/<workspaceId>/     # 标准 Tio 对象、分片和附件
├── .tio-page/
│   ├── config.ts                # 唯一站点配置入口
│   ├── template.ts              # 可替换的页面/聚合/分页模板
│   ├── style.css
│   ├── scripts/                 # 可选的个人脚本
│   └── dist/                    # 默认构建产物，加入 .gitignore
└── .github/workflows/pages.yml
```

## 分层

| 入口                      | 职责                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `@glink25/tio-pages/ssr`  | 当前块/行内内容的语义 HTML；转义、URL、提及、附件映射和块扩展，不包含站点布局 |
| `@glink25/tio-pages/page` | 显式路由计划、页面引用、文件收集与校验；模板决定选择哪些页面及输出路径        |
| `@glink25/tio-pages/code` | 可选的构建时 Shiki 高亮与 HTML/Mermaid 阅读预览，不包含个人 CSS               |
| `@glink25/tio-pages/node` | 标准文件层、配置加载、资源收集、暂存后输出                                    |
| `.tio-page/`              | 个人站点的全部展示和发布策略；可自由替换模板、CSS、JS、分页及特殊页面逻辑     |

`buildSite(content, plan)` 是不写入持久化的底层 API，也接受由同一份对象快照生成计划的异步工厂。需要其他框架时可从这里接入，当前不依赖 Astro。

## 配置与构建

正式发布 `@glink25/tio-pages@0.1.0` 后，可在个人工作空间直接运行，无需克隆 Tio 源码、安装 pnpm 或添加 package.json：

```sh
npx --yes @glink25/tio-pages@0.1.0 build
# 可选的工作空间、输出目录与配置文件
npx --yes @glink25/tio-pages@0.1.0 build /absolute/workspace -o /absolute/html -c /absolute/workspace/.tio-page/config.ts
# 也可固定安装版本，再使用 CLI
npm install --save-dev --save-exact @glink25/tio-pages@0.1.0
npx tio-pages build
```

默认读取 `<workspace>/.tio-page/config.ts`，输出 `<workspace>/.tio-page/dist/`。输入路径相对于调用目录；构建替换输出目录，拒绝覆盖工作空间数据或配置目录。GitHub Actions 使用相同 npx 命令。仓库内开发可先执行 `corepack pnpm pages:bundle`，再用 `corepack pnpm pages:build /absolute/workspace -o /absolute/html`。

最小配置：

```ts
import { defineSite } from '@glink25/tio-pages';

export default defineSite({
  workspaceId: 'my-space',
  assets: { 'theme.css': './style.css', 'app.js': './scripts/app.js' },
  stylesheets: ['/theme.css'],
  scripts: ['/app.js'],
  code: {
    themes: { light: 'github-light', dark: 'github-dark' },
    previews: ['html', 'mermaid'],
    defaultMode: 'split',
  },
  template: (objects, { headHtml }) => ({
    routes: [
      {
        path: '/hello',
        pageId: 'hello-page',
        render: (site) =>
          `<!doctype html><html><head>${headHtml()}</head><body>${site.renderPage('hello-page')}</body></html>`,
      },
    ],
  }),
});
```

`assets` 的键是输出相对路径，值相对配置文件所在目录；`stylesheets` 和 `scripts` 声明公开 URL。配置可直接导入自己的模板模块，返回自定义路径与渲染函数；静态资源可包括任意 CSS、JS、图片和其他文件。`headHtml()` 在路由渲染时调用，包含个人配置的资源；HTML 预览入口由构建器按实际渲染结果逐页添加。模板不必采用示例的 Tags/PageMap 模型。

配置文件是可信可执行代码，不是上传内容的沙箱。配置加载器将 TS 与本地模块编译到内存，并解析工具提供的 `@glink25/tio-pages` API，无需复制配置到工具仓库。它不改写业务 JSON。

## 代码块

Shiki 在构建时仅加载实际使用的语言，生成深浅主题 token。浏览器不加载高亮语法包；未知语言保留源码并按纯文本显示。`code: false` 或不配置 `code` 可使用基础 SSR。

HTML/Mermaid 的 `code`、`preview`、`split` 优先采用块的 `props.displayMode`，未指定时采用 `code.defaultMode`；普通语言始终显示代码。阅读模式用原生 radio 与 CSS 切换，不写回工作空间；Mermaid 切换不需要 JavaScript。

- `previews` 控制启用的预览，`themes` 配置高亮主题，`labels` 配置模式及预览标题文案，`assetDirectory` 配置输出资源目录。普通代码块直接输出高亮 `<pre><code>`，没有工具栏或运行时。
- HTML 使用 `sandbox="allow-scripts"` 的独立 iframe。仅包含 HTML 预览的页面加载 iframe 初始化脚本，源码直接从已高亮的 DOM 文本读取，不再重复序列化一份源码。
- Mermaid 在构建时通过 Puppeteer 和官方 Mermaid 库生成深浅主题 SVG，以 `<picture>` 选择主题。不输出 Mermaid 脚本、语法解析器、字体包或其他运行时。没有 JavaScript 时也可以显示图表并切换 code/preview/split。
- Mermaid 源码非法会中止构建，保留上一次输出。构建机需要 Chrome/Chromium：可使用 Puppeteer 安装的浏览器，或配置 `code.mermaid.executablePath` / `PUPPETEER_EXECUTABLE_PATH` 指向现有浏览器；`code.mermaid.args` 提供构建浏览器启动参数。普通文档与代码高亮不启动浏览器。
- `renderBlock` 扩展可调用 `context.requireScript(url)` 注册本页必需脚本，构建器逐页去重注入。第三方或个人配置的脚本独立于 workspace 渲染，保持显式配置。
- 全部样式仍在站点 CSS 中；站点自行提供深浅主题、原生模式控件和窄屏分屏样式。

`renderBlock(block, context)` 可扩展或覆盖块渲染，`context.renderChildren` 用于递归渲染子块。未知块默认使构建失败，避免静默丢失内容。路由使用解码的根路径（`/post/中文` 输出 `post/中文/index.html`），重复输出或缺失附件会失败。

个人博客的模板、配置、样式和部署工作流由目标 workspace 自行维护；本包不包含特定博客实现。

## npm 发行

公开包名 `@glink25/tio-pages`，可执行文件名 `tio-pages`，Node.js 24+。发布产物只包括编译后的 ESM、类型声明、浏览器预览入口、README 与 MIT LICENSE；Tio 内部代码内联，运行依赖中没有 `workspace:*`、私有 `@tio/*` 或 TypeScript 执行器。`.tio-page/` 只需引用本包公开 API；常用对象类型与文本辅助函数也从主入口导出。

```sh
# 正式发布（需要有效 npm 身份与 @glink25 的发布权限）
cd packages/pages
npm publish --access public
```

`prepack` 自动构建发布产物。发布时按需在 Git 忽略的 `tests/tmp/` 中安装真实 tarball，验证独立 CLI、用户配置类型、高亮/静态 SVG 与阅读端资源边界，并记录本次实际结果。仓库不保留静态发布专项测试。不应把该本地产物验证或 `npm publish --dry-run` 记为已上传 registry。

这里提供的 GitHub Pages 工作流属于目标 workspace 仓库：工作流保存在目标目录的 `.github/workflows/pages.yml`。它安装已发布的 npm 包，读取同仓库的 `.tio-page/` 和 `workspaces/`，构建并部署该 workspace 的站点。本体仓库不注册博客部署或 npm 自动发布工作流；npm 包由维护者按上述命令单独发布。

`slug` is re-exported from `github-slugger` for trusted site configuration. A blog may configure `slugify: (title) => slug(title, true)` and its own post route function; the package does not prescribe publication fields or URL rules.
