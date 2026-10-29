# 编辑器接入

完整富文本与数据库编辑区域可以独立复用。宿主负责导航、主题、语言、仓库、权限和后台同步。当前提供 Web 参考实现及独立浏览器 bundle，尚无原生应用或已发布 npm SDK。

```ts
const editor = await mountEditor(container, {
  repository,
  workspaceId,
  target: { id: pageId },
  presentation: { theme: 'dark', locale: 'zh', readOnly: false },
  onNavigate: (target) => hostNavigate(target),
  onSaveState: (state) => showSaveState(state.status),
  onError: (error) => report(error),
});
await editor.open({ id: anotherPageId });
editor.setPresentation({ theme: 'light' });
await editor.flush();
await editor.dispose();
```

`mountBridgedEditor(container, transport, {sessionId, workspaceId}, options)` 通过桥接提供同一编辑能力。独立构建在 `globalThis.TioEditor` 暴露两种挂载函数及 `createAppSliceRuntimeDocument`。

保存、同步进度及持久化错误统一由宿主展示；编辑器不显示保存状态或持久化失败横幅。独立接入使用 `onSaveState`、`onError` 与句柄的 `getSaveState()` 接收状态，由宿主调度 `retry()` 恢复；Web 宿主将这些信息集中在顶部状态图标中，悬停查看提示，点击展开详情，仅在需要时提供恢复授权入口。编辑器保留内容加载、字段校验等交互反馈。

宿主传入已解析的 `Presentation`，编辑器不写宿主偏好。每个实例具有独立主题、语言和门户上下文。共享弹窗使用独立全屏 Portal 外壳，安全区通过 `--tio-safe-top/right/bottom/left` 在内部布局消费；`--tio-screen-height` 在普通浏览器为 `100dvh`，standalone 为 `100vh`。可见视口测量仅参与输入时的键盘避让，不覆盖外壳高度。`onReady` 在挂载后触发；`open` 先刷新并重新检查关闭状态；`dispose` 异步合并并发调用，刷新失败时保留会话。不得因远端故障丢弃当前草稿。

React 接入的 `EditorSurface` 支持可选的 `readingMode` 和 `onReadingModeChange(boolean)` 受控阅读模式，由宿主保存偏好；未提供时使用编辑器临时状态。`readOnly` 与 `presentation.readOnly` 仍是不可由阅读菜单解除的强制只读约束。Web 宿主在浏览器统一记住阅读选择，没有偏好时移动布局默认阅读、桌面默认编辑。阅读模式中的铅笔仍打开文档菜单。

React 接入的 `EditorSurface` 可通过 `renderEmptyState()` 定制无当前目标时的区域；默认显示空页面插画和新建按钮。Web 宿主首次下载尚未完成时暂不传入内容目标，通过该插槽展示骨架屏或初始化错误与重试；就绪后恢复原目标。指定目标的加载、缺失和权限提示仍由编辑器处理。

`EditorSession` / `WorkspaceRuntime` 是 Web 与桥接接入共享的数据接口。宿主无界面修改使用 `executeBasic`，仍走仓库校验与变更事件。后台同步不依赖编辑器打开，系统副作用只在确认提交后触发，不在命令重放时执行。

- [仓库与 JSON 桥接](../../host-protocol/docs/bridge.md)
- [提供方异步读取](../../../docs/architecture/provider-access.md)
- [领域与 UI 扩展](../../../docs/protocols/extensions.md)
- [App Slice](app-slice.md)

## 附件上传

宿主仓库必须提供 `attachmentPolicy: { maxFileBytes, maxImageBytes }`，单位为字节，等于上限时允许上传；`EditorSession.attachmentPolicy` 将策略传给所有内容上传入口。文件类 provider 通过 `FileStorageProvider` 和 `WorkspaceContentPort` 传递同一策略。GitHub 所有附件均不超过 10 MB；设备存储与本地文件夹普通附件不超过 20 MB，封面和图标图片不超过 10 MB（1 MB = 1024 × 1024 字节）。

上传区点击选择后立即处理，数据库附件沿用字段草稿的完成/取消行为。普通上传及导入的附件均在运行时创建前和仓库暂存时校验；通用附件元数据构造不指定上限。超限返回 `DomainError('asset-size', ..., { maxBytes })`，由 UI 使用实际限制生成提示与错误。图片格式和解码校验独立于大小策略。

## 提及

正文和数据库提及字段共用 `MentionService`，支持同空间页面、数据库、记录及宿主提供的 GitHub 人员。仓库提供独立 `queryMentions({text, after, limit, kind?})` 和批量 `readMetadata(ids)`；记录摘要标题从数据库标题字段派生，不读取目标正文到运行时缓存。

宿主可传入 `mentions` 替换默认服务；React 接入可用 `createMentionService(runtime, workspaceId, navigate, people?)` 组合内容与人员来源。`people` 按需返回 `{reference, title, description?}[]`，由宿主负责连接和缓存。`query` 返回 `sourceErrors` 时展示来源级重试，其他来源候选仍可使用。GitHub 人员引用保存 `{workspaceId, kind: 'github-user', id, login}`，离线解析使用用户名快照；点击仅打开 GitHub 主页。

## 页面导出

共享页面菜单提供 Markdown 和 PDF 导出，独立嵌入与 Web 宿主行为一致，只读模式仍可导出。导出读取当前会话的文档快照与 `readAsset`，不要求宿主提供编辑器实例或 DOM。转换模块动态加载；PDF 字体按需从 jsDelivr CDN 加载，使用固定 `Sans2.004` release 的官方 Noto Sans SC 字体，宿主不必再随构建产物部署 `.otf` 文件。首次使用 PDF 需要加载对应引擎与字体，首次导出依赖网络，离线首次导出不作保证。

## 页面文件导入与数据库转换

文档支持 Markdown 和附件 ZIP 导入子页面，数据库支持 CSV/XLSX 导入子数据库。导入与导出均从更多菜单的独立分组进入二级菜单，各格式实现使用动态导入；CSV、XLSX 处理库不进入静态编辑器入口。数据库导出和列转换依赖 `EditorSession.databaseSnapshot` 分页读取完整数据库，列类型修改使用 `convertField` 与统一撤销历史；宿主仓库需要提供记录查询能力。文件创建和附件保存仍经过现有运行时与仓库。

当前格式备份恢复应调用 `runtime.import(objects, assets)` 保留系统时间；普通创建与复制调用 `runtime.create`，由命令层生成新时间。文档信息由共享编辑器只读展示，宿主不维护独立时间字段。

列表型选择共用 `@tio/ui` 的 `OptionsPanel`，异步候选通过 `usePagedOptions` 触底追加。`MentionService.query(text, after?, kind?)` 按类型在分页前筛选，`kinds` 声明可用分类；游标仅适用于原查询与类型。失败保留已加载候选并通过宿主通知通道提示，重新打开或改变查询后重新读取，不提供分页或重试按钮。

## 外部操作与当前会话

宿主可将当前 WorkspaceRuntime 绑定到 `@tio/operations`，通过授权后的 SDK/工具调用无界面业务操作。不要另开 runtime 或直接代理原始仓库写入来绕过用户未确认输入。共享操作层不依赖 UI；原生接入需提供相同的内容校验和会话生命周期管理。WebMCP 注册、授权弹窗和浏览器本地权限属于 Web 宿主。

App Slice broker 复用操作层的纯修改函数，但继续执行自身页面引用范围与受保护对象限制；外部 agent 的空间编辑权限不会赋予 App Slice 新的执行授权。详见[操作服务](../../operations/README.md)和[Web 使用说明](../../../docs/development/site-tools.md)。

## 内容链接与引用页脚

`EditorTarget` 支持可选 ContentAnchor 和 requestId。重复导航到同一位置时递增 requestId；编辑器等待内容就绪，滚动并高亮块/字段，不获取编辑焦点。不存在的位置提示失效，不修改正文。

`contentLinks` 由宿主提供：`create(ContentTarget)` 生成可复制 URL，`accepts(url)` 同步确认是否为当前应用/空间的内容链接，`parse(url)` 异步解析并校验可访问目标。块把手和移动工具栏使用复制入口；代码与纯文本粘贴不转换。异步解析期间若正文发生变化，不替换已插入的 URL，避免覆盖后续输入。

`onOpenGraph(id)` 请求宿主打开关系图；编辑器只负责页脚内容和临时 UI，App Mode 在导航菜单保留该入口。未实现 repository.relations 时展示不支持状态。mountEditor 和直接 EditorSurface 均可接入这些选项。

Web 宿主 URL：`#/w/<workspaceId>/p/<id>?block=<blockId>` 或 `?field=<fieldId>`；全空间图为 `#/w/<workspaceId>/graph?focus=<id>`。URL 不承载凭据，也不建立跨空间内容关系。
