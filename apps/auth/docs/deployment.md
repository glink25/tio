# GitHub App 鉴权 Worker

本 Worker 为可选登录服务，不代理文档，不保存数据库、KV 或安装私钥。PAT 模式不依赖它。存储行为见[GitHub 提供方](../../../packages/provider-github/docs/storage.md)。

创建启用过期用户 token 的 GitHub App，配置 Metadata 读、Contents 读写与仓库创建权限。用户选择安装仓库，新建仓库可能需加入安装范围后才能同步。

| 配置                   | 含义                                       |
| ---------------------- | ------------------------------------------ |
| GITHUB_CLIENT_ID       | App client ID，当前部署作为 secret         |
| GITHUB_APP_SLUG        | App 安装地址 slug                          |
| FRONTEND_ORIGIN        | 逗号分隔的精确前端 origin                  |
| REDIRECT_URI_ALLOWLIST | 逗号分隔的精确回调 URL，包含路径和末尾斜杠 |
| GITHUB_CLIENT_SECRET   | Worker secret，不能放入 Vite 环境          |
| STATE_SECRET           | 用于认证加密的高熵 secret，跨部署保持稳定  |

App callback 与安装 Setup URL 均指向 `https://<worker>/api/github/callback`。Web 构建设置 `VITE_GITHUB_AUTH_URL=https://<worker>`，未设置时仅提供 PAT。例如前端 `https://tio.example/` 对应 allowlist 的完整 URL 和 CORS 的 `https://tio.example`。

从 `apps/auth/` 执行：

```sh
corepack pnpm dlx wrangler secret put GITHUB_CLIENT_ID
corepack pnpm dlx wrangler secret put GITHUB_CLIENT_SECRET
corepack pnpm dlx wrangler secret put STATE_SECRET
corepack pnpm dlx wrangler deploy
```

若使用忽略的 `.env`，可传 `wrangler deploy --secrets-file .env`；仅加载本地变量不会自动上传 secret。具体域名及 origin 默认值见本应用 `wrangler.toml`，部署前应核对，不能把配置存在视为线上验证成功。

Worker 提供 GET `/api/github/login`、GET `/api/github/callback`、POST `/api/github/exchange`、POST `/api/github/refresh`，使用加密 state、PKCE、安装检查与两分钟交换 grant。grant 短期且绑定 verifier，但无服务端单次消费存储。

前端清理回调参数，凭据与业务内容分开保存，跨标签页通过 Web Locks 串行刷新 token。网络失败不应清除凭据。来源与 MIT 声明见 [LICENSE.ahead](../LICENSE.ahead)。真实 App 安装与部署需使用专门环境人工联调。
