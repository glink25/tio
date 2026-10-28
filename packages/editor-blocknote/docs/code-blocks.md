# 富文本与代码块

`codec.ts` 负责 Tio 块与当前编辑器 schema 的转换。未知块、行内或样式内容作为只读不透明块保存，邻近内容编辑后仍需原样往返。表格采用当前 BlockNote 兼容结构，可选列宽持久化为 JSON null；提及为原子节点，不保存编辑器产生的 undefined 子内容。

代码块使用 `codeBlock`，源码保存在 content，语言在 `props.language`，展示模式在 `props.displayMode: code | preview | split`。Mermaid 不保存 SVG；Markdown 导出保留语言围栏和源码。普通源码及未知 props 同样保留。

支持常见 JavaScript/TypeScript、HTML/CSS、JSON/YAML、Python、Shell、SQL 等语言与别名，未识别语言仍可作为普通代码编辑。Shiki、主题和语言语法按需加载；Mermaid 仅在非空预览时加载。生产 PWA 可能后台预缓存 JS，不能据此承诺首次使用前完全不下载可选块。

Mermaid 插入时默认 split；缺少模式时默认 preview。源码修改延迟刷新预览，语法或加载失败保留源码编辑入口。只读模式临时切换展示不写文档。渲染采用 strict 安全配置、唯一 ID、序列化主题配置，并丢弃过期异步结果。

领域扩展见[扩展约定](../../../docs/protocols/extensions.md)。编解码保障在 `tests/unit/rich-text/`，真实输入、撤销与表格编辑在 `tests/e2e/`。

## HTML 预览

Mermaid 与 HTML 共用 `code / preview / split` 展示模式。通过代码块语言选择器切换到 HTML 或 Mermaid 时默认 split；缺少模式时默认 preview。HTML 不提供独立斜杠菜单。只读切换只修改临时 UI，不写文档。

HTML 原始源码直接交给 `srcdoc` iframe，支持片段、完整文档以及内联和外部 JavaScript；源码修改防抖 300ms 后重新加载，code 模式卸载 iframe。预览宽度随容器，高度固定 400px，超出内容在 iframe 内滚动。空源码显示提示；脚本错误留在 iframe 内。用户 HTML 自行决定样式，宿主主题变化不重载预览。

iframe 使用 `sandbox="allow-scripts"` 和 `referrerPolicy="no-referrer"`，不授予同源权限。不注入 App Slice SDK、通信通道或资源限制 CSP，不提供 Tio 数据读写或尺寸 API。外部资源默认放行，实际加载仍受浏览器、宿主 CSP、混合内容及服务端 CORS 等规则约束。保存及 Markdown/HTML 导出保留源码，不保存运行结果。
