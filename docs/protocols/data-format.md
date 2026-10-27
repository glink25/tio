# 当前数据契约

业务对象具有 `id`、`workspaceId`、`type`、`schemaVersion`，删除用 `deleted: true`。空间对象 `id` 等于 `workspaceId`。ID 匹配 `[A-Za-z0-9_-]+`，不随名称改变；更新不得改变身份、类型、版本或数据库归属。

| 类型         | 主要字段                                                     |
| ------------ | ------------------------------------------------------------ |
| workspace    | name                                                         |
| page         | title、parentId、order、blocks、可选 icon                    |
| database     | name、parentId、order、fields、可选 icon                     |
| record       | databaseId、按字段 ID 保存的 properties、blocks、时间元数据  |
| databaseView | databaseId、layout、visibleFieldIds、filters、sorts、groupBy |
| asset        | filename、mime、byteSize、assetPath                          |

导航由 `parentId/order` 派生，不保存第二份权威子节点清单。删除父节点隐藏其导航子树。数据库嵌入通过 databaseId/viewId 引用；删除嵌入不删除数据库。

## 富文本与字段

块包含 `id/type/props/content/children`。普通行内文本形如 `{type: 'text', text: '内容', styles: {bold: true}}`。表格使用当前 BlockNote 兼容结构。未知块、行内类型和样式通过只读不透明块原样往返；编辑已知属性不得丢弃未知属性。

提及形如 `{type: 'mention', props: {workspaceId, kind: 'page' | 'database', id}}`，为无标题、无子内容的原子节点，可位于段落、嵌套块或表格单元格。提及字段保存同一引用或 null。目标删除后保留引用；不提供跨空间引用关系。

文本为字符串，数值必须有限，选项使用稳定 ID，关系使用记录 ID。日期采用 `{start, end?, timeZone?}`；公式和汇总已提供受限计算能力。字段、查询与派生值见[数据库字段](../../packages/database/docs/fields.md)。移除字段不会批量清空记录中的旧值。

图片与文件使用 `asset:<assetId>`；宿主解析为临时 Blob URL，后者不能序列化。句柄、凭据、个人偏好、回执和同步基线不属于业务 JSON。

## 文件、导出与扩展

文件 JSON 使用 UTF-8、递归键排序、两空格缩进和末尾换行，数组顺序有意义。对象路径必须与身份一致；分片、附件布局见[文件存储](../../packages/file-storage/docs/storage.md)。数据库服务不必实现文件布局。

JSON ZIP 是可恢复备份。当前 Web 导入新建空间 ID，重写对象的 workspaceId 和空间对象 ID，普通对象 ID 保持不变，Web Slice 块重新生成 ID 以隔离授权；不覆盖其他空间。嵌套提及保留原 workspaceId，导入后可能成为不可用引用，当前导入器不递归重写这类值。Markdown ZIP 为有损阅读投影，包含文档链接和附件，不能替代 JSON 备份。

仅接受当前格式，不提供历史读取、转换、迁移或双写。未注册类型保留 JSON，但不因此可编辑；注册类型严格接受其声明版本。扩展规则见[扩展约定](extensions.md)。删除标记和不可变分片不自动清理。
