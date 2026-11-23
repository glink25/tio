# Cloudflare Pages 部署

前端继续使用 Cloudflare Pages 项目 `tio`，与原生平台共用 [Release 工作流](releases.md)。不迁移现有域名，也不将站点改成 Workers 静态资源托管。

## 发布方式

在 `apps/native/release-plan.json` 中配置 `web.deployment`：

- `tag`：默认策略。受影响的 Web 随正式版本标签自动部署到 Pages 生产分支；RC 标签部署预览分支。
- `manual`：自动标签发布跳过 Web；在同一个 `Release` 工作流选择源码标签、指定 `targets=web` 并启用 `publish`。

平台也可通过 `targets` 数组单独选择或排除 Web。未受影响的平台不重建。工作流按锁文件安装 npm 依赖，执行根目录完整构建，保留独立编辑器构建与 CSS 作用域检查。

部署使用已经构建并校验摘要的站点归档，Cloudflare token 和 account ID 存放在 `web-release` 环境。启用标签发布前应先关闭现有 main 自动构建；新部署任务也通过 API 关闭 Pages Git 集成的生产和预览自动构建，避免第二条生产发布链；生产分支取自现有项目设置。也可以由项目所有者先在 Pages 设置中关闭自动构建。

此前 main 自动部署是云端设置。本次仅修改发布代码与文档，尚未连接 Cloudflare 修改该设置或部署站点。正式启用前应确认 `web-release` 环境具备 Pages 编辑与部署权限，详见[发布环境配置](releases.md#发布环境配置)。

## 域名与鉴权

生产域名为 `https://tio.linkai.work`，Pages 默认域名为 `https://tio-14r.pages.dev`。自定义域名通过 Pages 的 Custom domains 添加，选择由 Cloudflare 自动配置 DNS，并等待域名验证与证书签发完成；不单独手动添加 DNS 记录。

鉴权 Worker 独立部署，配置见 [GitHub App 鉴权 Worker](../../apps/auth/docs/deployment.md)。前端构建变量仅包含公开服务地址，GitHub client secret 与 state secret 只能保留在 Worker 中。
