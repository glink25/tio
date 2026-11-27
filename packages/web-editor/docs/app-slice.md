# App Slice

`appSlice` 块保存 HTML 小应用，复用普通文档与数据库。业务内容存储代码与展示参数，授权由宿主本地保存，不随导出或同步传播。[账本示例](examples/ledger.html)使用内联 SVG，无需网络，可创建普通数据库记录。

## 权限与作用域

默认只读、禁止外部资源。实例授权分为读写与外部资源，权限不能由脚本自改。可访问当前页面显式引入的数据库及直接提及的页面/数据库；不沿父子关系、目标引用或关联递归扩散。宿主资源与字段权限始终有效，异步读取后及提交前重新检查。

移除最后一个直接引用或删除目标会撤销后续访问，已交付内容无法收回。写操作不能引入越权引用、修改 App Slice 代码/授权、移动或删除受保护容器。宿主 `presentation.readOnly` 禁止写入；编辑器本地阅读模式不撤销已授权应用。

## SDK v1

用户脚本执行前提供 `window.tio`，调用返回 Promise。主要接口：

| 接口                                             | 能力                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| context.get()                                    | API 版本、页面/实例、主题、语言、时区和有效授权                |
| page.get()/getBlocks()                           | 当前页面元数据、块及版本                                       |
| page.update/insertBlocks/updateBlock/removeBlock | 当前页面普通内容修改，需传读取版本                             |
| pages.get(id)                                    | 直接提及页面的同类读取/编辑句柄                                |
| databases.list/find/get                          | 当前可访问数据库，find 要求名称唯一，get 返回句柄              |
| databases.create                                 | 原子命令创建数据库、默认视图和页面引用，文件发布仍为可恢复语义 |
| table.get()/records.query/get                    | 结构与记录读取，记录不包含正文                                 |
| table.records.create/update/delete               | 记录写入，属性键为字段 ID                                      |
| table.fields.list/find/create/update/delete      | 字段管理，名称歧义报错                                         |
| table.views.list/create/update/delete            | 视图管理                                                       |
| subscribe(listener)                              | 作用域内变更事件，避免收到通知就无条件写入                     |
| ui.resize(height)                                | 请求 160–1200px，高度可被宿主手动设置覆盖                      |
| request(method,payload,options)                  | 相同白名单的底层调用，不暴露仓库                               |

```js
const databases = await tio.databases.list();
const table = tio.databases.get(databases[0].id);
const { records, nextCursor } = await table.records.query({ limit: 100 });
const created = await table.records.create({ amount: 38 }, { requestId: crypto.randomUUID() });
await table.records.update(created.id, { amount: 40 }, created.version);
```

查询默认 100、最多 1000 条，接受 cursor/viewId/filters/sorts；不指定视图时查询数据库全部记录，分页不是冻结快照。过滤为 `{fieldId, op: eq|contains|notEmpty, value?}`，排序为 `{fieldId, direction: asc|desc}`。日期使用 `{start,end?,timeZone?}`。公式、汇总及系统时间只读；SDK 不返回派生记录值缓存。

记录更新和删除使用当前 iframe 会话中 `records.query()`、`records.get()` 或已确认写入回执提供的不透明版本。记录未变化时，这些版本可互换，即使列表查询只读取轻量投影。发生真实版本变化或目标存在未确认的修改时返回 CONFLICT，重新读取并核对内容后再决定修改。每次写入形成一个撤销项，提供方完成提交后才确认。请求 15 秒超时不等于取消；同运行会话内以相同 requestId 和载荷重试返回原结果，不能用新 ID 重试结果不明的创建。账本示例在超时后保持待确认状态和提交锁，使用原 requestId 与原载荷再次等待结果，不把超时当作保存失败后新增一笔。刷新后开始新会话，先检查持久化内容。每会话最多 10,000 个不同请求，消息与日志有大小/速率限制。

错误包括 PERMISSION_DENIED、RESOURCE_REMOVED、CONFLICT、INVALID_INPUT、RATE_LIMITED、CLOSED、TIMEOUT。部分失败附带结构化 `reason`：`slice_read_only` 表示实例只读，`database_out_of_scope` 表示页面没有直接引用目标表，`field_unavailable` 表示提交的字段不可用，`version_mismatch` 表示版本冲突，`host_permission` 表示宿主权限拒绝。字段失败可以附带请求中提交的 `fieldKey`，对不存在和无权读取的字段使用同一原因。事件来源为 App Slice 块 ID 或远端的 null。

## 嵌入与执行边界

`EditorSurface` 与挂载函数接受 `appSlice: {namespace, permissionStore}`；store 提供同步 get/set，可选 subscribe 用于多实例变更通知。宿主保存失败不能启用权限；未提供存储时授权只持续到会话结束。

默认使用不透明来源 `srcdoc`，sandbox 仅 allow-scripts。一次 token 与窗口身份握手后使用独立 MessagePort；导航、移除、重启和销毁使旧通道失效。撤销前已提交的写入仍可能完成，尚未发送的命令应拒绝。

可选可信 `runtimeUrl` 接收 `?external=0|1#token=...`，端点需按 external 生成 `createAppSliceRuntimeDocument('', external)`，使用生成的 CSP，不能携带凭据或直接托管用户内容。

CSP 在用户 HTML 前安装，剔除用户 meta 策略和 base。禁止同源访问、原生表单提交、弹窗、顶层导航、嵌套 frame、worker 和 object；表单使用按钮事件与 SDK。外部授权允许 HTTPS 资源和 HTTPS/WSS 请求，仍受 CORS 约束，没有特权代理。

iframe 自身导航不能作为完整防外传边界，iframe 不保证 CPU/内存配额或中止无限循环。修改已授权代码的人属于可信维护者。运行器在 SDK 初始化后安装脚本并派发 DOMContentLoaded/load，不提供 npm 转译或打包。

## App Mode

`page.appMode` 启用文档的应用展示；有编辑权限者从文档菜单开启、从宿主导航当前页面菜单关闭。正文按深度优先顺序的第一个 App Slice 填满展示区域，编辑器正文与块工具栏不挂载；无实例时显示空状态，不自动修改配置。全屏展示忽略固定高度与 `ui.resize`，应用自行滚动，沙箱及授权规则保持一致。

`EditorSurfaceProps.renderHeader(actions, {appMode, navigationPageActions})` 提供布局状态与可直接放置的菜单项。App Mode 开启时，编辑器提供关闭菜单项，宿主仅将其放入导航树当前页面菜单；资格、阅读限制、权限与运行时命令均留在编辑器中。宿主不为此加载正文、查找 App Slice 或修改文档配置。宿主隐藏顶部栏，保留侧栏和收起时的展开入口。

## 二进制附件

[完整附件示例](examples/attachments.html)演示文件选择、生成二进制、文档和记录附件、预览、下载及移除引用。

`tio.attachments` 通过原有读写授权访问目标当前引用的文件，不提供按任意附件 ID 访问工作空间的入口。文档目标为 `{kind:'page', pageId?, afterBlockId?}`，省略 pageId 表示当前页面；其他页面必须被直接提及。记录目标为 `{kind:'record', databaseId, recordId, fieldId}`，字段必须是可读写的 `files` 字段，数据库必须显式可访问。

```js
const target = { kind: 'page' };
const { version } = await tio.attachments.list(target);
const { ref } = await tio.attachments.write(
  target,
  { name: 'result.bin', mime: 'application/octet-stream', bytes: new Uint8Array([0, 128, 255]) },
  { version, requestId: crypto.randomUUID() },
);
const file = await tio.attachments.read(target, ref); // {name, mime, bytes: Uint8Array}
await tio.attachments.download(target, ref);
```

`write` 也接受用户通过 `<input type="file">` 选择的 `File`。一次调用将二进制、元数据和目标引用作为一个可恢复命令保存，确认后返回 `{ref,version}`；文档按 MIME 插入图片、音频、视频或文件块，记录附件字段追加引用。每个沙箱同时只允许一个二进制传输，超限返回 `RATE_LIMITED`；`context.get().attachmentPolicy` 给出提供方大小限制，超限返回 `ASSET_TOO_LARGE`。二进制保持原始字节，不经过 Base64、图片重编码或 JSON 数字数组。

`list` 返回 `{version,attachments:[{ref,name,mime,byteSize,blockId?|fieldId?}]}`。图片、音频和视频可用 `const preview = await tio.attachments.preview(target, ref)` 获取本沙箱 Blob URL，将 `preview.url` 放入对应媒体元素，用完调用 `preview.release()`；其他文件通过 `download` 下载，不执行 HTML，不开放嵌套 iframe。下载由可信编辑器发起，沙箱无额外权限。

`remove(target, ref, {version,requestId?})` 删除文档媒体块或字段引用，保留被其他位置使用的底层附件；移除后不能再借该目标读取文件。修改采用读取版本并支持撤销重做。写入超时后用相同 requestId、目标、版本、文件元数据和字节重试；SDK 重用该会话的上传凭据，宿主返回同一次提交结果。更改载荷会返回 `INVALID_INPUT`。重新打开 App Slice 后应先 list 确认现有内容。
