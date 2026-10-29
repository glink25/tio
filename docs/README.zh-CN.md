# Tio

本地优先的文档与数据库编辑器，可使用设备存储、本地文件夹或 GitHub 仓库。设备、文件夹和 PAT 模式无需应用服务端；GitHub App 登录使用可选的鉴权 Worker。

[English](README.md) · [Tio 之禅](zen.md)

Fork [示例空间](https://github.com/glink25/tio-demo-space)，即可快速体验文档、数据库和 App Slice。

## 启动

使用 Node.js 24 和 `packageManager` 锁定的 pnpm：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

访问 `http://localhost:6789`。生产预览依次运行 `corepack pnpm build` 和 `corepack pnpm preview --port 4175`。生产部署的浏览器文件系统及离线能力需要 HTTPS。

## 能力与边界

已实现富文本、多级页面、提及、表格/看板、多种字段、公式、汇总、回收站、JSON 备份、Markdown 导出、代码高亮、Mermaid 和 App Slice。完整编辑器可独立嵌入。

文件发布为尽力而为，不承诺多文件原子可见，也不能保证任意外部并发写入下零丢失；后台同步需要宿主运行。尚无原生应用、WebDAV、实时协作或删除标记/分片自动清理。浏览器数据可能被清理，重要内容应备份。原生目录权限及真实设备输入法需人工验证。

## 文档索引

- [产品约定](product/requirements.md) · [后续方向](product/roadmap.md)
- [整体架构](architecture/overview.md) · [提供方读取与恢复](architecture/provider-access.md)
- [数据契约](protocols/data-format.md) · [扩展约定](protocols/extensions.md)
- [开发与贡献](development/contributing.md) · [测试](development/testing.md)
- [编辑器接入](../packages/web-editor/docs/integration.md) · [App Slice](../packages/web-editor/docs/app-slice.md)
- [文件存储](../packages/file-storage/docs/storage.md) · [GitHub 存储](../packages/provider-github/docs/storage.md)
- [数据库字段](../packages/database/docs/fields.md) · [代码块](../packages/editor-blocknote/docs/code-blocks.md)
- [安全说明](governance/SECURITY.md) · [第三方声明](governance/THIRD_PARTY_NOTICES.md) · [变更记录](governance/CHANGELOG.md)

项目原创代码使用 [MIT 许可证](../LICENSE)，依赖保留各自许可证。
