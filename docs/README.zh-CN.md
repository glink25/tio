# Tio

**本地优先的文档与数据库编辑器。**

[English](README.md) · [架构](architecture.md) · [数据协议](data-format.md) · [验证记录](verification.md)

Tio 是一个本地优先的浏览器工作空间。通过块式文档、表格、看板和关联记录组织内容，无需专用服务端或云端账号。

## 启动

使用 Node.js 24 LTS，项目通过 `packageManager` 固定 pnpm。无需修改系统中的旧版 pnpm：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

打开 `http://localhost:6789`。选择离线模式，或选择本地文件夹并授权读写。

验证生产版离线重开：

```sh
corepack pnpm build
corepack pnpm preview --port 4175
```

首次在线打开 `http://localhost:4175` 并等待资源缓存完成，再断网重开。开发服务器不安装生产 Service Worker；实际部署使用 HTTPS。

## 使用方式

- **Offline**：直接创建工作空间，内容自动保存 IndexedDB，刷新恢复。
- **Local Folder**：选择文件夹后进入空间选择器，可创建和切换多个工作空间，直接读写 `workspaces/<workspaceId>/` 下的 JSON 和附件。
- 点击页面或数据库标题编辑；空间菜单支持重命名。正文输入 `/` 添加块、子页面或页面引用。顶部“数据库”可创建内嵌数据库或引用已有数据库。
- 数据库支持表格和看板，点击名称打开详情；所有展示共享同一条 Record。
- 字段设置支持基础类型、单选/多选选项和同 workspace 关联。看板支持拖拽或通过卡片状态菜单移动。
- 侧栏支持嵌套拖拽、同级插入和移动选择器；搜索可用 `⌘/Ctrl K`。
- 默认黑白浅色，可切换深色并记住选择。多级页面支持折叠、面包屑、引用和反向链接。
- 中英切换即时生效并记住选择；不会把已有正文和用户命名重新翻译。
- 导出 ZIP 包含规范 JSON 与附件；导入产生独立本地实例，不覆盖现有空间。空间菜单也提供 Markdown 阅读导出。
- 同步异常可查看具体文件。文件被外部移除时报告错误，不会静默视为删除。

## 工程质量

19 个 pnpm workspace 项目；Vite 8 / Rolldown；Oxc React 转换；**Oxlint + 类型感知 tsgolint + Oxfmt**；Tailwind CSS 4；Lucide；Radix Dialog；i18next / react-i18next；TypeScript strict；Vitest / Playwright；GitHub Actions。

React 18.3.1 保持在 Glide 最新稳定版声明的兼容范围内；不通过忽略 peer dependency 强制升级。UI 已拆为页面、功能模块和共享 UI 包，应用 CSS 只保留主题、基础输入样式和编辑器边界。

```sh
corepack pnpm check
corepack pnpm lint:fix
corepack pnpm format
corepack pnpm test:e2e
```

## 边界

Local Folder 以桌面 Chrome/Edge 为目标；其他环境通过能力检测决定是否提供入口。手机仍支持 Offline。浏览器关闭后不持续执行同步。不承诺任意并发文件覆盖零丢失。

未实现 GitHub、公式/汇总计算、日历、回收站和历史界面。当前提供数据库默认视图及简单筛选排序。桌面自动化、OPFS 目录句柄测试不能替代原生授权弹窗和手机真机验收，详见验证记录。

原始三份设计/调研文档保存在 `docs/.local/`，已加入 `.gitignore`。文件夹保存等待文件写入完成；中断提交保留最小恢复日志，授权失效后停止写入，不保存完整 IndexedDB 正文副本。

See [provider-owned asynchronous access](async-provider-access.md) for storage guarantees and loading behavior.
