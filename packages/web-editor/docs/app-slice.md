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

更新/删除传入读取版本，冲突返回 CONFLICT，重新读取再决定修改。每次写入形成一个撤销项，提供方完成提交后才确认。请求 15 秒超时不等于取消；同运行会话内以相同 requestId 和载荷重试返回原结果，不能用新 ID 重试结果不明的创建。刷新后开始新会话，先检查持久化内容。每会话最多 10,000 个不同请求，消息与日志有大小/速率限制。

错误包括 PERMISSION_DENIED、RESOURCE_REMOVED、CONFLICT、INVALID_INPUT、RATE_LIMITED、CLOSED、TIMEOUT。事件来源为 App Slice 块 ID 或远端的 null。

## 嵌入与执行边界

`EditorSurface` 与挂载函数接受 `appSlice: {namespace, permissionStore}`；store 提供同步 get/set，可选 subscribe 用于多实例变更通知。宿主保存失败不能启用权限；未提供存储时授权只持续到会话结束。

默认使用不透明来源 `srcdoc`，sandbox 仅 allow-scripts。一次 token 与窗口身份握手后使用独立 MessagePort；导航、移除、重启和销毁使旧通道失效。撤销前已提交的写入仍可能完成，尚未发送的命令应拒绝。

可选可信 `runtimeUrl` 接收 `?external=0|1#token=...`，端点需按 external 生成 `createAppSliceRuntimeDocument('', external)`，使用生成的 CSP，不能携带凭据或直接托管用户内容。

CSP 在用户 HTML 前安装，剔除用户 meta 策略和 base。禁止同源访问、原生表单提交、弹窗、顶层导航、嵌套 frame、worker 和 object；表单使用按钮事件与 SDK。外部授权允许 HTTPS 资源和 HTTPS/WSS 请求，仍受 CORS 约束，没有特权代理。

iframe 自身导航不能作为完整防外传边界，iframe 不保证 CPU/内存配额或中止无限循环。修改已授权代码的人属于可信维护者。运行器在 SDK 初始化后安装脚本并派发 DOMContentLoaded/load，不提供 npm 转译或打包。
