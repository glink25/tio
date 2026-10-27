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

`mountBridgedEditor(container, transport, {sessionId, workspaceId}, options)` 通过桥接提供同一编辑能力。独立构建在 `globalThis.TioEditor` 暴露两种挂载函数及 `createWebSliceRuntimeDocument`。

宿主传入已解析的 `Presentation`，编辑器不写宿主偏好。每个实例具有独立主题、语言和门户上下文。`onReady` 在挂载后触发；`open` 先刷新并重新检查关闭状态；`dispose` 异步合并并发调用，刷新失败时保留会话。不得因远端故障丢弃当前草稿。

`EditorSession` / `WorkspaceRuntime` 是 Web 与桥接接入共享的数据接口。宿主无界面修改使用 `executeBasic`，仍走仓库校验与变更事件。后台同步不依赖编辑器打开，系统副作用只在确认提交后触发，不在命令重放时执行。

- [仓库与 JSON 桥接](../../host-protocol/docs/bridge.md)
- [提供方异步读取](../../../docs/architecture/provider-access.md)
- [领域与 UI 扩展](../../../docs/protocols/extensions.md)
- [Web Slice](web-slice.md)
