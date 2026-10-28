# 扩展约定

领域注册与 UI 扩展分开；纯领域和同步不导入 React 或 BlockNote。宿主创建实例级 `createDomain()`，在打开会话前注册对象及字段定义，并向仓库、运行时、文件编解码和同步器传递同一语义定义。跨进程分别注册，函数不通过 JSON 桥接传输。

对象定义包含当前版本、校验和合并。校验贯穿命令、直接提交及文件编码/解码；合并必须确定、对两分支对称，并保留身份。注册类型只接受声明版本，没有迁移回调。未知类型与字段保留载荷，不能通过添加 UI 渲染器绕过领域校验。

`mountEditor` 支持：

- `domain`：领域定义。
- `extensions.schema`：扩展 `defaultEditorSchema`，保留内置引用、App Slice 和不透明块。
- `extensions.codecs`：按块类型提供 `accepts/toEditor/fromEditor`；codec 负责其自定义行内及样式内容。
- `extensions.slashItems(editor)`：实例级斜杠菜单扩展。
- `views.fields[type]`：标签、输入组件和本地化展示。
- `views.layouts[name]`：接收公共查询结果与编辑处理器的布局组件；未知布局明确显示不支持。

当前包导出 TypeScript 源码供 monorepo 使用。独立编辑器浏览器构建不是已发布、带声明和版本兼容承诺的 npm SDK。接入见[编辑器文档](../../packages/web-editor/docs/integration.md)，具体能力见[App Slice](../../packages/web-editor/docs/app-slice.md)及[代码块](../../packages/editor-blocknote/docs/code-blocks.md)。
