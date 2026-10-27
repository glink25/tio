# 依赖维护

版本以各包 `package.json` 和根锁文件为准，不在文档重复维护版本清单。使用兼容的稳定版本，遵守 pnpm 的发布时间策略；成组升级 BlockNote、Oxc 等耦合依赖，并提交锁文件。不能仅为消除提示而覆盖 peer 约束。

- Vite、React 插件和 Tailwind 构建应用；React 主版本应同时满足编辑器及数据库视图库的 peer 范围。
- BlockNote core/react/shadcn 保持一致；代码高亮与 Mermaid 按需加载。
- Oxfmt、Oxlint/tsgolint、TypeScript 属于公共开发工具；Vitest、Playwright、fake-indexeddb 等测试依赖只声明在 `@tio/tests`。
- CSS 转换器依赖 PostCSS，构建工具不能因测试搬迁而丢失依赖。
- `fflate` 是序列化运行时依赖，同时由直接使用它的测试包声明。

升级构建或编辑器依赖后运行完整检查和核心浏览器流程。许可证以实际分发版本的包内文件为准，参见[第三方声明](../governance/THIRD_PARTY_NOTICES.md)。
