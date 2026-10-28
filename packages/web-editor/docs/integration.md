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

宿主传入已解析的 `Presentation`，编辑器不写宿主偏好。每个实例具有独立主题、语言和门户上下文。`onReady` 在挂载后触发；`open` 先刷新并重新检查关闭状态；`dispose` 异步合并并发调用，刷新失败时保留会话。不得因远端故障丢弃当前草稿。

`EditorSession` / `WorkspaceRuntime` 是 Web 与桥接接入共享的数据接口。宿主无界面修改使用 `executeBasic`，仍走仓库校验与变更事件。后台同步不依赖编辑器打开，系统副作用只在确认提交后触发，不在命令重放时执行。

- [仓库与 JSON 桥接](../../host-protocol/docs/bridge.md)
- [提供方异步读取](../../../docs/architecture/provider-access.md)
- [领域与 UI 扩展](../../../docs/protocols/extensions.md)
- [App Slice](app-slice.md)

## 页面导出

共享页面菜单提供 Markdown 和 PDF 导出，独立嵌入与 Web 宿主行为一致，只读模式仍可导出。导出读取当前会话的文档快照与 `readAsset`，不要求宿主提供编辑器实例或 DOM。转换模块动态加载；PDF 字体按需从 jsDelivr CDN 加载，使用固定 `Sans2.004` release 的官方 Noto Sans SC 字体，宿主不必再随构建产物部署 `.otf` 文件。首次使用 PDF 需要加载对应引擎与字体，首次导出依赖网络，离线首次导出不作保证。

## 页面文件导入与数据库转换

文档支持 Markdown 和附件 ZIP 导入子页面，数据库支持 CSV/XLSX 导入子数据库。导入与导出均从更多菜单的独立分组进入二级菜单，各格式实现使用动态导入；CSV、XLSX 处理库不进入静态编辑器入口。数据库导出和列转换依赖 `EditorSession.databaseSnapshot` 分页读取完整数据库，列类型修改使用 `convertField` 与统一撤销历史；宿主仓库需要提供记录查询能力。文件创建和附件保存仍经过现有运行时与仓库。

当前格式备份恢复应调用 `runtime.import(objects, assets)` 保留系统时间；普通创建与复制调用 `runtime.create`，由命令层生成新时间。文档信息由共享编辑器只读展示，宿主不维护独立时间字段。
