# Tio Pages 与博客复刻

静态发布能力见 [@glink25/tio-pages](../../packages/pages/README.md)，个人博客位于同级 `tio-blog` workspace，其配置与使用说明随该 workspace 保存。

渲染和文件输出分开：`ssr` 只投影当前块为 HTML；`page` 接收显式路由计划，处理页面引用和附件；Node 宿主复用 `FileWorkspaceContent` 读取标准对象及分片。博客模板通过 PageMap 的页面提及、Tags 关系与发布字段决定输出，不依赖编辑器生命周期。Urodele 转换限定在示例迁移器中，核心不引入历史 Tio 格式兼容。

## 本次本地验收（2026-10-27）

实际读取公开博客源 commit `e122064cdcd0d50ea8a2dd004a310edb764f061e`，迁移命令通过运行时与文件仓库创建新空间，没有改动原博客仓库。

| 项目       | 本次结果                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| 文章       | 42 篇全部进入 `post` 子页面，其中 40 篇非草稿输出 HTML                                |
| 标签       | 15 个，使用 Tags + PageMap 的提及与多选关系                                           |
| 附件       | 57 次图片引用去重为 56 个独立附件，全部嵌入空间                                       |
| 正文       | 逐篇递归比较源与迁移结果，文字完全一致                                                |
| 代码       | 222 个代码块，逐块原始字符串一致，保留空白                                            |
| 路由       | 61 条：40 篇文章、4 页首页、标签聚合和各标签分页                                      |
| 本地 HTTP  | 全部 61 条路由及其中站内 href/src 返回 200                                            |
| ZIP 备份   | 当前导入器校验成功，附件数与工作空间一致                                              |
| 自动检查   | `corepack pnpm check` 通过；16 个测试文件、121 项测试，以及类型、lint、边界和生产构建 |
| 新渲染测试 | 7 项，覆盖转义、URL、列表/表格/代码、未知块、提及、分片/附件和重复路径                |
| 浏览器     | 隔离 Chromium 检查桌面首页、文章、标签页；390px viewport 首页/代码文章无页面横向溢出  |

最终博客工作空间已移动到 Tio 工具仓库同级的 `../tio-blog/`，默认 HTML 输出为 `../tio-blog/.tio-page/dist/`；早期预览输出 `.tmp/tio-blog-html/` 仅保留为验收产物。测试证据位于忽略目录 `tests/.cache/blog-verification.json`、`tests/.cache/blog-visual/` 和 `tests/.cache/blog-mobile/`，业务数据与生成站点不提交到 Tio 工具仓库。

截图工具在本机 Chromium 的 390px 窗口截图存在最小窗口宽度造成的裁切，因此另外使用 Playwright 设置真实的 390px viewport，并检查 `documentElement.scrollWidth === innerWidth === 390` 后截图复核；这不是实际手机验证。

尚未执行真实目录选择授权、在 Web 编辑器中保存并重开该空间、GitHub Actions 云端构建或部署，也未验证 giscus 登录和评论发送。生成工作流需要固定版本的 `@glink25/tio-pages` 已发布到 npm，并在博客仓库启用 Pages 的 Actions 发布源。原站的编辑/登录入口不是静态阅读站点的一部分；目录浮层与原站所有交互未逐项复刻。

## 配置隔离与代码块补充验收（前一实现，以下静态化记录已替换其 Mermaid 运行时设计）

个人配置改为工作空间内的 `.tio-page/config.ts`，与模板、CSS、脚本同目录；外部保持 `workspaces/<id>/` 数据和 `.github/workflows/` 工作流。`corepack pnpm pages:build <workspace> [-o output] [-c config]` 是本地与 Actions 的共同入口，不再导入工具仓库中的个人示例配置。

构建时使用 Shiki 按实际语言高亮，浏览器不携带语法包。HTML/Mermaid 使用块的 `displayMode` 或配置默认值，支持 code/preview/split。HTML 沙箱不授予同源权限，Mermaid strict 渲染本地模块且按需加载；预览失败后保留源码。通用块 DOM 在包内，全部 CSS 在站点目录。

补充检查：

- 独立临时工作空间只靠自己的 `.tio-page/` 更换作者模板、CSS、JS、路径及主题，重复构建正确替换旧输出；拒绝覆盖工作空间数据。
- Pages 逻辑测试 10 项通过；完整检查通过（17 个测试文件、124 项测试、类型/lint/边界/生产构建）。
- `corepack pnpm test:pages` 的 2 条真实 Chromium 用例通过，覆盖两种预览的三种初始模式与切换、HTML 沙箱、真实 Mermaid SVG、失败后源码、深浅高亮颜色、无 JS 阅读与按需请求。390px viewport 无页面横向溢出。
- 深浅主题 HTML/Mermaid 分屏和 390px 上下分屏已截图复核，稳定块截图位于 `tests/.cache/pages-preview-visual/*-stable.png`。
- GitHub Actions 已加入相同浏览器用例。没有声称本地运行等于云端部署成功。

## 独立 npm 发行补充

包名改为维护者已有 scope 下的 `@glink25/tio-pages`。CLI 为 `tio-pages build`，个人 Actions 直接运行固定版本的 npx 命令；不检出 Tio 工具仓库，不引用 `TIO_REF`。个人配置与模板仅使用公开包导出，Tio 内部依赖在编译时打包，发布物含 ESM、类型声明与浏览器入口，不发布源码路径。

已通过真实 tarball 安装验证：无需私有包、tsx 或编辑器依赖，Node CLI 能从标准工作空间读取内容，处理独立 TS 配置，生成 Shiki HTML 和本地 HTML/Mermaid 预览模块；消费者配置及实际博客模板的 TypeScript 检查通过。也通过显式 tarball 的 npm exec 调用验证。产物与消费者项目位于 `tests/.cache/pages-package/`。

npm 上传与本地验收分开记录：本次只执行打包、安装与 publish dry-run。当前 npm 身份检查为未认证，尚未上传 registry，也未执行云端部署。npm 包由维护者单独发布，首次发布仍需有效 npm 身份。

博客构建部署工作流只属于目标 workspace 仓库。部署工作流位于目标 workspace 的 `.github/workflows/pages.yml`；本体 `.github/workflows/` 仅保留质量检查 CI，不注册博客部署或 npm 自动发布。

## Workspace 渲染静态化验收（2026-10-28）

审计范围是 workspace 的渲染产物；giscus 等显式配置的第三方脚本单独计数，未删除评论配置。

- 普通代码只输出 Shiki 高亮后的 `<pre><code><span>`，没有编辑器包装、工具栏、语法包或浏览器解析器。
- HTML 预览只有包含该预览的页面才注册 iframe 初始化脚本，代码为 466 字节，直接读取高亮 DOM 中的源文本；不重复序列化源码。
- Mermaid 改为构建时使用 Puppeteer 与官方 Mermaid 库生成深浅 SVG。站点只包含 `<picture>` 与 SVG；模式切换是原生 radio + CSS，无浏览器 Mermaid 模块。非法 Mermaid 使构建失败，既有输出不受影响。
- 浏览器实测：Mermaid 单独页面请求零 JavaScript；禁用 JavaScript 后图表、code/preview/split 均可用。SVG 图片确实解码成功；HTML 沙箱与高亮深浅主题、390px 布局检查通过。
- 实际博客 61 页中，57 页没有 Tio 注入脚本，4 页仅注入同一个 466 字节 HTML 初始化脚本；另有 40 次第三方 giscus 引用。当前博客没有 Mermaid 块，Mermaid 通过专用真实渲染夹具验证（2 页、4 个 SVG、1 个 HTML 初始化脚本）。
- 审计脚本 `tests/scripts/audit-pages-output.mjs` 检查 JavaScript 文件、脚本引用、编辑器属性、重复源码与 SVG 可执行内容。真实 tarball 安装测试也调用该审计，并验证非法 Mermaid 不覆盖已生成页面。

复现审计：

```sh
corepack pnpm pages:build ../tio-blog
node tests/scripts/audit-pages-output.mjs ../tio-blog/.tio-page/dist tests/.cache/blog-static-audit.json
```

本次构建测试使用已有 Playwright Chromium。Puppeteer 默认下载在本机返回了无效压缩包，因此不将自动下载行为记为已验证；可按包文档指定现有 Chrome。构建端浏览器与解析库没有进入静态站点。

## 原博客时间与置顶排序恢复（2026-10-28，已由系统时间方案替代）

发现初次迁移将记录系统 `updatedAt` 统一变成导入时间，导致首页 Pin 文章排序不准确。PageMap 新增独立日期字段 `updated`（Updated），从原博客 `__ud_update_time` 恢复 42 篇文章的时间；`published` 继续保存 `__ud_create_time`。通过 WorkspaceRuntime 和 FileRepository 更新已迁移空间，备份也同步刷新，不改写只读系统时间。

首页精确匹配 Tags 中名为 `Pin` 的标签：置顶文章按文章更新时间倒序，普通文章按创建时间倒序，再进行分页；相同置顶更新时间保留原创建时间顺序。标签列表和相邻文章使用原创建时间顺序。添加或移除 Pin 关系即可改变首页是否置顶。

验证：对照原博客源数据逐项检查 42 篇日期、全部首页与标签分页顺序；4 条排序测试覆盖跨分页置顶、普通文章排序、标签/相邻文章、Pin 关系变化与相同更新时间。当前前三篇置顶为 Cent、欢迎使用 Urodele、Urodele 博客系统。

## 统一系统时间（2026-10-28）

所有内建对象直接更新 v1 契约，要求 UTC `createdAt`、`updatedAt`。统一命令层维护时间，专用导入保留来源值；编辑器文档信息只读展示。上述 PageMap 手工日期方案已经移除，博客直接读取文章页面的系统时间，Pin 和创建时间排序规则不变。

转换前完整备份到同级 `tio-blog-before-system-timestamps-20261028-103720`，一次性转换 161 个对象，为 42 篇文章恢复原始日期，移除 PageMap 两个日期列及值与视图引用，并刷新 JSON ZIP。生产代码不包含旧格式兼容。

## 列表与站点导航补齐（2026-10-28）

修复编辑器 codec 对显式声明类型、但默认值为 undefined 的 BlockNote 属性校验；有序列表的数字 `start` 可正常编辑与无损保存。SSR 继续输出原生 `ol/li`。站点配置恢复原博客 menu-4-fill SVG 与 favicon，Footer 的 Tools 通过原生 details 展开 Oncent、Peek、My Days 链接；内容和样式均在 `.tio-page` 中，不新增客户端脚本。

## 可选文章 Slug（2026-10-28）

PageMap 的 `path` 文本列改为可选的 `slug`。站点配置通过 `slugify(title)` 指定默认算法（原博客 `github-slugger.slug(title, true)`），通过 `routes.post(slug)` 指定路径（默认 `/post/`）。显式 slug 优先；空值与空白值按标题生成。生成空 slug 时构建报错，重复 URL 由静态构建统一拒绝。当前 42 条映射保留原 URL 的 slug，文章页面及其系统时间不变，ZIP 已刷新。

## 正式 npm 包与独立博客

移除本体 `examples/blog` 及其迁移、构建、预览快捷命令。个人站点由同级 `tio-blog` 维护；本体仅在 `tests/fixtures/pages/blog` 保留排序、SSR 和发布产物测试所需的固定夹具。目标 workspace 直接通过 npm 的 `@glink25/tio-pages@0.1.0` 构建。

正式发布：`@glink25/tio-pages@0.1.0` 已通过 npm 账号双重认证上传 registry；目标博客的构建命令和 GitHub Actions 均固定使用该版本，本地预览使用 workspace 内独立 Node 脚本。
