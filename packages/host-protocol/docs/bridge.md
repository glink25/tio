# 仓库与 JSON 桥接

仓库接口定义在 `@tio/core`，桥接实现位于本包。宿主绑定仓库、空间和可信身份；session/workspace 路由检查不能替代认证。

## 仓库契约

- `readSnapshot/readChanges` 返回空间版本与修订条目；异步正文、导航、记录、扫描和元数据读取见[提供方契约](../../../docs/architecture/provider-access.md)。
- `commit` 执行身份、格式与权限校验，返回受影响条目及紧凑回执。原子仓库使用版本 CAS；文件仓库提供可恢复发布。
- `getCommitResult` 用原提交 ID 恢复响应丢失；`acknowledgeCommits` 压缩确认序列，水位防止重复执行。已压缩请求不能重新执行。
- `subscribeChanges` 携带版本、commitId、origin 和 changedIds；重复或漏通知通过版本读取及提交重试恢复。
- `attachmentPolicy` 是 provider 必须提供的单文件字节上限：`maxFileBytes` 用于普通附件，`maxImageBytes` 用于封面与页面图标，后者不得大于前者。运行时与编辑器共享该策略，GitHub 本地副本沿用 GitHub 策略。
- `stageAsset/readAsset/releaseAsset` 区分暂存与已提交字节，读权限与对象权限一致。

宿主保留客户端不可读字段，并校验所有直接提交。原生平台可提供更强的权限与存储能力，但不能让编辑器依赖具体数据库、句柄或端点。

## 消息与租约

消息包含 protocol、sessionId、workspaceId、id、kind、method、payload，边界做运行时校验。握手返回并校验 `attachmentPolicy`（正安全整数），无有效策略时拒绝连接；`asset-size` 错误保留结构化 `details.maxBytes`。握手协商能力；不支持的扩展返回 unsupported。实际传输为 JSON，不假设 structured clone。重复或延迟响应不能完成另一个请求，新通道使用新桥接实例。

二进制传输使用不透明上传/下载/释放引用，不暴露文件路径。宿主消费上传后释放引用；请求超时不等于取消正在消费的传输。实现租约、幂等释放与到期清理，loopback 参考实现为 60 秒。更大传输可由原生通道续租。

重新连接仍保留未确定提交的身份，先读取当前权威状态再重试。权限拒绝与连接授权失效分开表达；重新授权必须恢复原身份和端点。生产原生通道需自行实现可信绑定与租约，不能把 loopback 当作已交付的原生安全实现。

接入示例见[编辑器接入](../../web-editor/docs/integration.md)。
