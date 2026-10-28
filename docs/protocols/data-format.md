# 当前数据契约

业务对象具有 `id`、`workspaceId`、`type`、`schemaVersion`，删除用 `deleted: true`。空间对象 `id` 等于 `workspaceId`。ID 匹配 `[A-Za-z0-9_-]+`，不随名称改变；更新不得改变身份、类型、版本或数据库归属。

| 类型         | 主要字段                                                     |
| ------------ | ------------------------------------------------------------ |
| workspace    | name                                                         |
| page         | title、parentId、order、blocks、可选 icon/cover              |
| database     | name、parentId、order、fields、可选 icon/cover               |
| record       | databaseId、按字段 ID 保存的 properties、blocks              |
| databaseView | databaseId、layout、visibleFieldIds、filters、sorts、groupBy |
| asset        | filename、mime、byteSize、assetPath                          |

页面和数据库的 `icon` 可以是 Emoji 字符串、`{type: 'builtin', name}` 内置图标，或 `{type: 'image', url}` 图片；空字符串表示移除。`cover` 为 `{type: 'preset', id}` 预设，或 `{type: 'image', url, positionY, credit?}` 图片，`null` 表示移除。预设与内置图标使用固定目录 ID；`positionY` 为 0–1 的垂直裁切位置，居中为 0.5。可选署名为 `{name, url}`，供精选 Unsplash 图片保留作者信息。

图片 `url` 使用 `asset:<assetId>` 或 HTTP(S) 链接，不保存 Blob URL。图标与封面修改及定位保存经过统一命令并推进自身修改时间；定位拖动和取消仅影响临时 UI。上传图片沿用附件存储、备份及同步链路。Markdown/PDF 的阅读投影与静态站点模板不自动包含文档装饰。

导航由 `parentId/order` 派生，不保存第二份权威子节点清单。删除父节点隐藏其导航子树。数据库嵌入通过 databaseId/viewId 引用；删除嵌入不删除数据库。

## 系统时间

所有内建对象的 `schemaVersion` 保持 1，并必需包含 `createdAt`、`updatedAt`。时间为 UTC ISO 字符串，修改时间不得早于创建时间；它们是对象系统元数据，不是数据库用户属性。未知扩展对象继续原样保留。

统一命令层在首次提交时固定时间，依赖加载、重放和重试沿用该时间。普通创建及复制生成新时间；`runtime.import(objects, assets)` 专用于当前格式导入并保留来源时间，JSON 备份导入使用此入口。普通 patch 和事务不能直接改写系统时间。

正文、标题、业务属性、图标、数据库字段定义等自身内容变化推进 `updatedAt`；空操作、移动、排序、删除恢复和视图展示配置不推进，子对象修改不级联更新父对象。内容撤销和重做视为当前编辑，保留 `createdAt`；时钟回退不使修改时间回退。数据库系统时间列从记录元数据派生。

同步接收保留原时间。三方合并使用共同基线的创建时间；没有基线时取最早创建时间，修改时间取各方最新值，不产生时间字段冲突提示。共享编辑器通过“更多 → 文档信息”只读展示时间，按当前语言和本地时区格式化。

## 富文本与字段

块包含 `id/type/props/content/children`。普通行内文本形如 `{type: 'text', text: '内容', styles: {bold: true}}`。表格使用当前 BlockNote 兼容结构。未知块、行内类型和样式通过只读不透明块原样往返；编辑已知属性不得丢弃未知属性。

提及形如 `{type: 'mention', props: {workspaceId, kind: 'page' | 'database', id}}`，为无标题、无子内容的原子节点，可位于段落、嵌套块或表格单元格。提及字段默认保存有序、不重复的引用数组，空值为 `[]`；`multiple: false` 时保存单个引用或 null。目标删除后保留引用；不提供跨空间引用关系。

文本为字符串，数值必须有限，选项使用稳定 ID，关系使用记录 ID。日期采用 `{start, end?, timeZone?}`；公式和汇总已提供受限计算能力。字段、查询与派生值见[数据库字段](../../packages/database/docs/fields.md)。移除字段不会批量清空记录中的旧值。

图片与文件使用 `asset:<assetId>`；宿主解析为临时 Blob URL，后者不能序列化。句柄、凭据、个人偏好、回执和同步基线不属于业务 JSON。

## 文件、导出与扩展

文件 JSON 使用 UTF-8、递归键排序、两空格缩进和末尾换行，数组顺序有意义。对象路径必须与身份一致；分片、附件布局见[文件存储](../../packages/file-storage/docs/storage.md)。数据库服务不必实现文件布局。

JSON ZIP 是可恢复备份。当前 Web 导入新建空间 ID，重写对象的 workspaceId 和空间对象 ID，普通对象 ID 保持不变，App Slice 块重新生成 ID 以隔离授权；不覆盖其他空间。嵌套提及保留原 workspaceId，导入后可能成为不可用引用，当前导入器不递归重写这类值。Markdown ZIP 为有损阅读投影，包含文档链接和附件，不能替代 JSON 备份。

页面正文支持粘贴 HTML 源码、富文本 HTML、Markdown 和 Tio 原生剪贴板内容；在当前选区插入并进入统一编辑历史。代码块内与纯文本粘贴保留原文，不将 JSON 文本识别为 Tio 导入。原生复制保留未知字段与不透明内容，粘贴生成独立块 ID，不迁移跨空间引用或附件。

页面更多菜单支持导出当前标题和正文：Markdown 无本地附件时下载 `.md`，有本地附件时下载包含相对路径附件的 ZIP；PDF 为可选文字的阅读排版。两者均不递归导出子页面，数据库嵌入、App Slice 和未知块显示静态摘要。导出捕获点击时的乐观文档快照，不等待远端同步；导出代码通过动态导入按需执行，PDF 引擎与中文字体不进入编辑器主入口的静态依赖；PWA 缓存沿用应用统一规则。

仅接受当前格式，不提供历史读取、转换、迁移或双写。未注册类型保留 JSON，但不因此可编辑；注册类型严格接受其声明版本。扩展规则见[扩展约定](extensions.md)。删除标记和不可变分片不自动清理。

### 页面文件导入与数据库表格导出

文档更多菜单的导入、导出独立成组，均使用二级格式菜单。Markdown 文件及附件 ZIP 导入为当前文档的直属子页面；附件使用既有资源暂存与创建命令，包内页面链接改写为新页面提及。导入不覆盖当前正文，整体进入统一撤销历史。

数据库 CSV/XLSX 导入为当前数据库下的子数据库；XLSX 每个非空数据表分别创建数据库与默认视图。导出覆盖全部列和未删除记录，不受当前视图、筛选、隐藏列或搜索影响，不包含记录正文。CSV 是带 UTF-8 BOM 的普通表格，不包含私有元数据。XLSX 的 `__tio_metadata` 极隐藏工作表保存 `tio-table` 格式标记、版本 1 和工作表字段定义；依赖外部内容的关系、提及、附件、公式、汇总及系统时间列导入为可读文本，其余内建类型恢复配置并生成新 ID。

无 Tio 元数据的 CSV/XLSX 使用相同整列推断：忽略空值，全部非空单元格一致符合布尔、有限安全数值或 ISO 日期规则时采用对应类型，否则使用文本；前导零编号和精度不安全的数字保留文本。首个非空行作为表头，首列固定为标题文本列。XLSX 公式只读取缓存结果，不执行公式。已识别但损坏或不支持版本的元数据报错，不静默套用错误类型。

文件解析及格式依赖均按操作动态加载，不进入编辑器入口静态依赖；PWA 预缓存沿用统一策略。

### 页面 App Mode

`page.appMode?: boolean` 为文档展示配置，缺省关闭，schemaVersion 保持 1。配置随 JSON 备份和空间同步传播，通过统一命令修改并支持撤销；不推进内容修改时间。开启后展示正文按深度优先顺序的第一个 `appSlice`，包括嵌套块，不沿引用查找。无 App Slice 时保留配置并显示空状态，允许有编辑权限者关闭。
