# 富文本与代码块

`codec.ts` 负责 Tio 块与当前编辑器 schema 的转换。未知块、行内或样式内容作为只读不透明块保存，邻近内容编辑后仍需原样往返。表格采用当前 BlockNote 兼容结构，可选列宽持久化为 JSON null；提及为原子节点，不保存编辑器产生的 undefined 子内容。

代码块使用 `codeBlock`，源码保存在 content，语言在 `props.language`，展示模式在 `props.displayMode: code | preview | split`。Mermaid 不保存 SVG；Markdown 导出保留语言围栏和源码。普通源码及未知 props 同样保留。

支持常见 JavaScript/TypeScript、HTML/CSS、JSON/YAML、Python、Shell、SQL 等语言与别名，未识别语言仍可作为普通代码编辑。Shiki、主题和语言语法按需加载；Mermaid 仅在非空预览时加载。生产 PWA 可能后台预缓存 JS，不能据此承诺首次使用前完全不下载可选块。

Mermaid 插入时默认 split；缺少模式时默认 preview。源码修改延迟刷新预览，语法或加载失败保留源码编辑入口。只读模式临时切换展示不写文档。渲染采用 strict 安全配置、唯一 ID、序列化主题配置，并丢弃过期异步结果。

领域扩展见[扩展约定](../../../docs/protocols/extensions.md)。编解码保障在 `tests/unit/rich-text/`，真实输入、撤销与表格编辑在 `tests/e2e/`。
