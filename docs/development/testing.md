# 测试

测试集中在私有 workspace 包 `@tio/tests`。配置、夹具、辅助脚本和产物都放在 `tests/`，根目录只转发命令。

| 命令（仓库根目录）                                                   | 用途                                               |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| `corepack pnpm test`                                                 | 核心逻辑测试                                       |
| `corepack pnpm test:watch`                                           | 交互运行核心逻辑测试                               |
| `corepack pnpm test:e2e`                                             | Chromium 编辑流程（自动构建并启动服务）            |
| `corepack pnpm check`                                                | 格式、lint、边界、全部类型检查、逻辑测试及生产构建 |
| `corepack pnpm --filter @tio/tests exec playwright install chromium` | 安装浏览器                                         |

在 `tests/` 内可直接使用 `corepack pnpm test`、`test:watch`、`test:e2e`、`typecheck`。配置和夹具基于文件位置解析仓库路径，不依赖调用目录。运行单组逻辑测试可用 `corepack pnpm --filter @tio/tests test unit/sync`。

## 保留范围

- domain：对象身份、合并、数据库基础查询和编辑校验。
- runtime：乐观命令、外部更新、提交回执、失败重试和关闭刷新。
- sync：调度、发布、文件恢复、分片、附件先行及 GitHub 发布竞争。
- rich-text：未知内容、表格、代码和原子提及的编解码。
- e2e：真实输入与保存重开、删除撤销、提及、表格以及宿主持久化与外部更新。

不维护独立认证、备份、沙箱权限、翻译、性能或展示套件；不测试菜单位置、颜色或徽标等细节。测试范围的缩减不表示其他功能已通过验证，也不应削弱生产权限或校验逻辑。

Vitest 缓存、Playwright 报告和失败 trace/截图均在 `tests/` 的忽略目录内。测试只使用临时数据或内存仓库，不操作用户目录。生产构建仍检查编译后的编辑器 CSS 作用域。

## 人工验证边界

原生目录选择器/授权、真实手机 IME/键盘/内存、GitHub App 安装和线上限流需要专门环境。当前核心自动测试不提供这些结论；不把既往通过记录写成本次验收。
