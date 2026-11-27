# GitHub 与 Gitee 鉴权 Worker

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

Apple 客户端通过系统认证会话接收 `tio://auth/github` 或 `tio://auth/gitee`。Android 使用 Auth Tab 或兼容浏览器的 Custom Tabs，回调交给发起认证的客户端。新版 Worker 校验加密 state 和回调白名单后，将服务商拒绝返回为 `access_denied`，其他服务商错误返回为 `oauth_failed`。客户端继续使用同一 PKCE 交换端点。

iOS 提审说明可写明：Tio 启动后可使用「仅此设备」创建和编辑工作空间。GitHub 和 Gitee 是可选仓库存储连接，授权用于访问用户选定的仓库。审核人员可从欢迎页启动设备空间体验主要功能，也可从同页启动系统认证会话。

## Gitee OAuth App

创建 Gitee 第三方应用，主页为 `https://tio.linkai.work/`，回调为 `https://tio-api.linkai.work/api/gitee/callback`。Worker 请求 `user_info projects` 权限。通过 Wrangler 将 `GITEE_CLIENT_ID` 与 `GITEE_CLIENT_SECRET` 配置为同一个 Worker 的 secrets。原生应用使用 `tio://auth/gitee`，Web 返回地址沿用现有精确白名单。Web 构建的 `VITE_GITHUB_AUTH_URL` 同时用于两种 OAuth。

Gitee 提供 `/api/gitee/login`、`/api/gitee/callback`、`/api/gitee/exchange` 和 `/api/gitee/refresh`。客户端使用短期加密授权码及 PKCE 向 Worker 兑换 token。无浏览器 Origin 的原生后台任务可用 JSON 请求刷新 token。私人令牌可独立完成登录和同步。

2026-11-26 使用本地 Web 生产构建和已部署的 `tio-auth` 完成真实 Gitee OAuth 登录、私有仓库创建和页面更新，并在 Gitee 提交详情核对改动。线上端点验证了登录跳转、跨提供方状态拒绝和无效刷新令牌响应。有效令牌刷新、私人令牌登录、第二个独立副本拉取及原生真机流程仍需验收。

2026-11-27 部署新版 Worker（版本 `82eb8052-f840-48b1-8e60-a77ab382559d`）。使用测试请求在线验证两家服务商的登录跳转、原生拒绝回调和跨服务商状态隔离。本地 Worker 还验证了通用失败回调和 Web 回调行为，客户端夹具验证了 PKCE、账号匹配和拒绝重复回调。iOS 模拟器包、macOS Xcode 和 Android 调试 APK 构建通过。iPhone 和 iPad 模拟器验证两个登录入口均显示系统认证提示，取消后恢复登录入口。Android 模拟器从 Chrome 首次启动流程取消后能返回 Tio。macOS 登录交互、真机账号授权、旧版 Android 浏览器回退和商店审核待验收。
