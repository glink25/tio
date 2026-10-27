# Tio 协作约定

## 入口

- 愿景与产品取舍：[docs/zen.md](docs/zen.md)。
- 架构与数据：[整体架构](docs/architecture/overview.md)、[数据契约](docs/protocols/data-format.md)。
- 工作流：[贡献指南](docs/development/contributing.md)、[测试](docs/development/testing.md)。

## 实现原则

- 宿主负责连接、空间、导航、主题、语言、访问策略与后台调度；编辑器完整复用，只管理内容交互和临时 UI 状态。
- 修改经过统一命令、运行时和仓库；组件不直接持久化，不另建保存队列。后台更新不能覆盖尚未确认的输入。
- 同步独立于编辑器生命周期；同步核心与宿主调度分开。存储提供方决定缓存、离线与持久化保证。
- 一个连接可有多个空间，一个逻辑空间绑定一个端点；不建立跨空间内容引用。
- 当前不读取、迁移或双写历史格式，不增加旧数据兼容分支。未知字段与不透明内容仍须无损保留。
- 业务判断使用结构化状态与错误码，不能根据展示文本或诊断措辞判断权限、重试和成功。
- 复用成熟组件，按需加载；保持职责清楚，不为假想场景增加兜底或双轨实现。
- 架构或产品方向存在实质疑问时先讨论；已明确的目标应做完整。

## 验证

- Node.js 24；安装：`corepack pnpm install --frozen-lockfile`。
- 开发：`corepack pnpm dev`；完整检查：`corepack pnpm check`。
- 相关逻辑：`corepack pnpm --filter @tio/tests test <路径>`。
- 富文本与编辑交互：`corepack pnpm test:e2e`。
- 保留编辑、运行时、同步和富文本核心保障；不恢复菜单外观等细枝末节的 UI 测试。
- 测试依赖、配置、夹具和产物集中在 `tests/`。如实记录本次验证，不以模拟结果代替真机或真实端点结论。
