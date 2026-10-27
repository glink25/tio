# 开发与贡献

阅读[架构](../architecture/overview.md)与[数据契约](../protocols/data-format.md)，AI 协作遵循根目录 [AGENTS.md](../../AGENTS.md)。

使用 Node.js 24、仓库锁定的 pnpm，执行 `corepack pnpm install --frozen-lockfile` 和 `corepack pnpm dev`。修改后执行 `corepack pnpm check`；涉及编辑交互再运行 `corepack pnpm test:e2e`。具体命令与测试范围见[测试说明](testing.md)。

Oxfmt 负责格式、导入与 Tailwind 排序；Oxlint 负责正确性与类型感知检查；TypeScript 独立严格检查。使用 `.vscode/` 推荐的 Oxc 扩展，不并行引入 ESLint/Prettier。工具与依赖维护见[依赖约定](dependencies.md)。

## 实现约束

- 修改经过命令、运行时与仓库，不在组件中直接持久化。纯包和编辑器的具体依赖边界由检查脚本维护。
- 业务分支读取类型化状态和稳定错误码，不能通过翻译、展示文本或 `Error.message` 判断重试、权限和成功。
- 保存状态、同步进度和连接访问状态分别表达；外部错误在适配器边界归一化，资源拒绝不等于登录过期。
- UI 字符串同时维护中英文，用户内容不随语言切换翻译。图标使用命名导入和可访问标签；复杂浮层复用共享组件。
- 样式优先使用 Tailwind，无法通过第三方组件属性表达的规则放在编辑器边界内。
- 不实现历史迁移；当前未知内容仍需无损保留，相关契约见数据文档。

提交描述写清行为变化和实际验证。不能用模拟 API 或桌面设备模拟替代原生权限和真机结论。

## 品牌与连接入口

品牌唯一源为 `apps/web/src/brand/logo.svg`，静态 Logo 与 Hero 共用该 SVG；动画只作用于整体与 `.mark-dot`。修改后执行 `corepack pnpm brand:icons`，提交生成的 `apps/web/public/` 图标。派生 SVG、favicon、Touch Icon 和 PWA PNG 不手工编辑；maskable 图标使用深色底和安全留白。

Web 连接入口注册于 `apps/web/src/services/connection-entry/`。各集成声明稳定 ID、翻译键、图标、层级、可用状态、提示与执行动作；同一集成的入口按按钮组渲染，次要入口可声明仅图标展示，宿主统一渲染和防止重复触发。目录选择须直接在点击调用链中执行；底层存储 provider 不依赖 React，也不承担登录按钮展示。

空状态插画源位于 `apps/web/src/components/illustrations/`，由 `EmptyStateIllustration` 统一提供尺寸、主题颜色和读屏文案。工作空间采用打开的空收纳盒，回收站采用掀盖的空桶，以可见内腔表达无内容；使用原创 SVG，不增加插画库依赖。设计参考 [Ant Design Empty](https://ant.design/components/empty/) 的空容器表达，以及 [Atlassian Illustrations](https://atlassian.design/foundations/illustrations) 的中性、单一概念原则。
