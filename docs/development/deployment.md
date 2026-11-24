# Cloudflare Pages 部署

Cloudflare Pages 项目 `tio` 通过 GitHub 集成拉取源码并构建 Web。GitHub CI 验证代码，原生发布走 [Release 工作流](releases.md)。

## 发布方式

- `web-production` 是生产分支。将通过 `main` 质量检查的提交推到该分支即可发布，合并 `main` 只更新开发分支。
- `preview-*` 是预览分支。将候选提交推到以 `preview-` 开头的分支，Pages 会生成预览地址。

例如，在 `v0.1.0-rc.8` 通过质量检查后推送预览分支。正式发布时将验证通过的提交推到 `web-production`。

```sh
git push origin v0.1.0-rc.8:refs/heads/preview-0.1.0-rc.8
git push origin "${release_commit}:refs/heads/web-production"
```

`release_commit` 取已验收的提交 SHA。

Pages 从仓库根目录运行 `corepack pnpm install --frozen-lockfile && corepack pnpm build`，产物目录为 `apps/web/dist`。发布后在 Pages 的 Deployments 核对环境、提交和部署状态。需要回退时，在 Pages 回退到上一份已验收的生产部署。

## 域名与鉴权

生产域名为 `https://tio.linkai.work`，Pages 默认域名为 `https://tio-14r.pages.dev`。自定义域名通过 Pages 的 Custom domains 添加，选择由 Cloudflare 自动配置 DNS，并等待域名验证与证书签发完成；不单独手动添加 DNS 记录。

鉴权 Worker 独立部署，配置见 [GitHub App 鉴权 Worker](../../apps/auth/docs/deployment.md)。前端构建变量仅包含公开服务地址，GitHub client secret 与 state secret 只能保留在 Worker 中。
