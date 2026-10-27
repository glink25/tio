# 文件存储

`FileWorkspaceContent` 在 `FileStorageProvider` 的文件原语之上实现对象内容接口；数据库后端可以直接实现对象接口，无需依赖分片文件。当前文件端点包括本地文件夹和 GitHub，WebDAV 尚未实现。

## 布局与分片

```text
workspaces/<workspaceId>/objects/<objectId>.json
workspaces/<workspaceId>/chunks/<hash-prefix>/<sha256>.json
workspaces/<workspaceId>/assets/<assetId>.<extension>
```

所有类型使用身份路径，名称变化不移动文件。小对象保存为规范 JSON；超过 UTF-8 字节预算的对象保存身份头与 `$storage: {version: 1, root}`。`$storage` 为文件 envelope 保留字段，业务 envelope 不可使用。

树递归拆分数组、对象、字符串和索引节点；字符串按 Unicode 标量边界拆分。不可变节点按内容寻址，默认文件预算 512 KiB，可配置，最低 1 KiB。读取检查哈希与预算，重建上限为 100,000 节点、200 MiB、128 层。文件分片不等于正文惰性编辑或与空间大小无关的启动成本。

## 发布与故障

分片先写，对象头最后替换；未变化分片按哈希复用。中断重试复用完成节点；缺失或损坏分片明确报错，不能退回旧内容或解释为删除。提供方完成写入后必须可读，仅不存在时返回 null，权限与传输错误应抛出。

最小文件接口不保证条件写入或多文件原子提交。文件夹使用 `createWritable()` / `close()`，协作写入由宿主锁协调，不能保证外部写入无竞态。直接仓库 `FileRepository` 的恢复日志和提交语义见[提供方读取与恢复](../../../docs/architecture/provider-access.md)。

删除用显式 tombstone。普通同步不自动删除不可变分片、历史代或无关文件；失败可能留下未引用分片。清理需要独立的保留与并发读取协议。

## 副本与批量能力

无变化同步读取对象一次，发布前重新读取；强指纹可启用有界缓存，不能用 mtime 代替内容指纹。文件夹无强指纹时仍读取对象头。损坏对象独立报告，不阻止其他对象同步；已有附件避免重复传输。

可选 `FileStorageProvider.snapshot()` 提供不可变读取与显式发布能力，文件层把头、分片、附件编码为一次批量发布。GitHub 使用 Git commit 和非强制 ref 更新；返回 false 表示远端竞争，发布成功前不得 ACK。文件夹仍采用直接可恢复发布。

行为保障见 `tests/unit/sync/`；业务格式见[数据契约](../../../docs/protocols/data-format.md)。
