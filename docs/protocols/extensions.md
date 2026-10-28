# 扩展约定

领域注册与 UI 扩展分开；纯领域和同步不导入 React 或 BlockNote。宿主创建实例级 `createDomain()`，在打开会话前注册对象及字段定义，并向仓库、运行时、文件编解码和同步器传递同一语义定义。跨进程分别注册，函数不通过 JSON 桥接传输。

对象定义包含当前版本、校验和合并。校验贯穿命令、直接提交及文件编码/解码；合并必须确定、对两分支对称，并保留身份。当前注册类型只接受声明版本，接口没有迁移回调。扩展的数据结构、协议和接口同样遵循[0.2.0 兼容性里程碑原则](../zen.md)：正式发布 0.2.0 前按全新设计，不考虑历史兼容、迁移或升级，不保留相关实现；0.2.0 及后续版本无需兼容或迁移此前数据。从 0.2.0 开始，后续变更才考虑对 0.2.0 及以后版本的兼容性、迁移和升级，届时评估所需扩展接口，不预设迁移方案。未知类型与字段仍须保留载荷，不能通过添加 UI 渲染器绕过领域校验。

`mountEditor` 支持：

- `domain`：领域定义。
- `extensions.schema`：扩展 `defaultEditorSchema`，保留内置引用、App Slice 和不透明块。
- `extensions.codecs`：按块类型提供 `accepts/toEditor/fromEditor`；codec 负责其自定义行内及样式内容。
- `extensions.slashItems(editor)`：实例级斜杠菜单扩展。
- `views.fields[type]`：标签、输入组件和本地化展示。
- `views.layouts[name]`：接收公共查询结果与编辑处理器的布局组件；未知布局明确显示不支持。

当前包导出 TypeScript 源码供 monorepo 使用。独立编辑器浏览器构建尚非已发布且带类型声明的 npm SDK；接口的兼容性责任以 0.2.0 正式发布为起点，遵循上述原则。接入见[编辑器文档](../../packages/web-editor/docs/integration.md)，具体能力见[App Slice](../../packages/web-editor/docs/app-slice.md)及[代码块](../../packages/editor-blocknote/docs/code-blocks.md)。
