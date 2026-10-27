# Cloudflare Pages 部署

前端由 Cloudflare Pages 项目 `tio` 托管，连接 GitHub 仓库 `glink25/tio`。推送 `main` 自动构建并发布生产环境，其他分支不自动生成预览部署。

## 构建配置

在 Pages 的 Settings > Build 中维护以下配置，工作目录为仓库根目录：

| 配置                      | 值                                                               |
| ------------------------- | ---------------------------------------------------------------- |
| Build command             | `corepack pnpm install --frozen-lockfile && corepack pnpm build` |
| Build output directory    | `apps/web/dist`                                                  |
| Build image               | v3                                                               |
| `NODE_VERSION`            | `24.22.1`（与根目录 `.node-version` 同步）                       |
| `SKIP_DEPENDENCY_INSTALL` | `true`，由构建命令使用仓库锁定的 pnpm 安装依赖                   |
| `VITE_GITHUB_AUTH_URL`    | `https://tio-api.linkai.work`                                    |

根目录构建命令依次构建独立编辑器与 Web，并检查编辑器 CSS 作用域。不能只运行 Web 子包构建。

## 触发路径

Build watch paths 的 Include 为 `*`，Exclude 为：

```text
docs/*
apps/auth/*
.github/*
.vscode/*
*.md
tests/e2e/*
tests/unit/*
tests/fixtures/*
```

仅修改上述路径时跳过部署；同时包含其他文件变更时仍部署。Pages 的 `*` 匹配路径分隔符，覆盖嵌套目录。保留 `tests/scripts/*` 的触发，因为生产构建调用其中的 CSS 检查脚本。锁文件、工作区配置、共享包、构建脚本变更仍会触发构建。

这些是 Pages 项目的云端配置，不由 Wrangler 配置文件管理。规则详见 [Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)。空推送或超大推送可能绕过路径过滤，按 Cloudflare 平台规则构建。

## 域名与鉴权

生产域名为 `https://tio.linkai.work`，Pages 默认域名为 `https://tio-14r.pages.dev`。自定义域名通过 Pages 的 Custom domains 添加，选择由 Cloudflare 自动配置 DNS，并等待域名验证与证书签发完成；不单独手动添加 DNS 记录。

鉴权 Worker 独立部署，配置见 [GitHub App 鉴权 Worker](../../apps/auth/docs/deployment.md)。前端构建变量仅包含公开服务地址，GitHub client secret 与 state secret 只能保留在 Worker 中。
