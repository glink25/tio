# 发布与更新

iOS 使用 Xcode Cloud 构建并交给 TestFlight／App Store；Android 使用 GitHub Actions 构建并通过 Play Developer API 上传 Google Play。IPA、AAB 不进入 GitHub Releases。macOS 保留签名、公证后的通用 DMG；Windows、Linux 同样直接下载。Web 沿用 Cloudflare Pages。原生动态包与安装包分别发布。

## 版本与发布判定

根目录 `package.json.version` 对应源码标签 `vX.Y.Z` 或 `vX.Y.Z-rc.N`。正式版使用 `stable` 索引，RC 使用 `preview`。`apps/native/release-plan.json` 定义：

- `revision`：递增的动态包版本号。
- `hostBuild`：Android 和桌面安装包的构建号，须同时高于该平台稳定、预览两个渠道已发布构建号。iOS 采用 Xcode Cloud 自增的 `CI_BUILD_NUMBER`，不与其他平台共享计数器。
- `targets`：`auto` 或 `ios-store`、`macos-direct`、`windows-direct`、`linux-direct`、`android-play`、`web` 的数组。
- `forceHost`：主动重建安装包的渠道数组。
- `apple.intent`、`apple.reason`：iOS 变更是已有行为修复还是需要审核的新功能。
- `compatibility.storage`、`compatibility.bridge`：协议输入变化须声明 `compatible` 或 `breaking` 并说明原因；不兼容变动还须增加契约版本。
- `web.deployment`：`tag` 随标签部署；`manual` 仅通过手动发布入口部署。
- `storeNotes`：商店语言的发布说明。Play 自动写入轨道说明；Apple 的商店元数据仍在 App Store Connect 管理。
- 可选 `content.translations`：仅覆盖已发布运行时已知的翻译键。

`host-contract.json` 规定桥接、持久化、能力、JS 引擎与 iOS 审核基线，规范化后生成 `contractId`。兼容的 UI、编辑器和 TypeScript 内核可发动态包；Rust、Swift、Kotlin、权限和原生构建输入变更需要新宿主。iOS 新功能还需增加 `reviewEpochs.ios-store`，不能发给旧审核基线的宿主。

判定分别比较各平台的已发布动态包和宿主输入记录，不比较仓库最近一个标签。iOS 的宿主记录表示已请求的 Cloud 标签，不表示 Cloud 归档、TestFlight 处理或商店审核已成功；实际状态以 Xcode Cloud／App Store Connect 为准，失败可对原宿主标签重试。Android 的测试发布权限不等于正式版发布权限，正式轨道仍受账号资质及应用权限限制。

Apple 下载代码仍受[审核规则](https://developer.apple.com/app-store/review/guidelines/)约束；Play 动态包不包含 dex、JAR 或原生库，参见[Play 政策](https://support.google.com/googleplay/android-developer/answer/16559646)。

## 发布标签与独立构建

准备并提交版本及计划，等待 main 上的质量检查通过，再生成计划：

```sh
node apps/native/release/fetch-baselines.mjs --out tests/tmp/release/baselines
node apps/native/release/plan.mjs --baseline tests/tmp/release/baselines --out tests/tmp/release/plan.json
node apps/native/release/tag.mjs --plan tests/tmp/release/plan.json
node apps/native/release/tag.mjs --plan tests/tmp/release/plan.json --push
```

本地提供仓库公开的 `TIO_RESOURCE_PUBLIC_KEY`、`TIO_UPDATER_PUBLIC_KEY`；计划必须描述当前已提交的 `origin/main`。标签工具默认只展示结果，`--push` 才原子推送源码标签及所需的 `host/ios-store/v<版本>`。不要只推源码标签而遗漏所需的 iOS 宿主标签。

- Xcode Cloud 的 `Tio iOS Host` 只监听 `host/ios-store/v*`，执行 iOS Archive，分发准备选 App Store Connect。手动入口也只接受该标签范围。普通动态更新不触发 iOS 安装包重建。
- Actions 的 `Release` 监听源码 `v*`，按平台独立执行。iOS 行只构建、签署相应动态包及宿主请求元数据，不读取或回传 Apple 安装包，不要求 Apple API key。
- Android 构建签名 AAB 后，调用 Play API 上传内容库并更新轨道：RC 为 `internal`，正式版为 `production`。首次须在 Play 控制台完成应用与上传证书初始化。没有生产发布权限的服务账号不能推正式轨道。
- macOS 在 Actions 构建 arm64／x86_64 通用包，验证 Developer ID、版本、架构、公证与 DMG 票据后发布。Windows、Linux 独立验证安装包和 Tauri 更新签名。
- Web 正式标签部署生产，RC 部署预览；设为手动时，在同一工作流选择 `targets=web` 与 `publish`。

手动 `Release` 默认只构建和验证产物，启用 `publish` 才执行 Play 上传、公开下载和更新索引。质量检查统一按 frozen lockfile 安装 npm 发布的 Chaty。

## 产物与失败恢复

安装包和动态包进入各自的生命周期：

- iOS 的签名归档和商店构建留在 Xcode Cloud／App Store Connect。Cloud 负责签名及上传；配置内部 TestFlight 群组后可自动分发。不创建回传安装包的 GitHub App。
- Play AAB 在构建 runner 内直接上传，流水线只保留提交回执和动态包。已提交的候选通过回执复用。若 Play 已收到构建但回执遗失，先核对 Play，使用新的构建号发布候选。
- 桌面安装包、原生动态包和内容包使用各自的 `dist/<版本>/<渠道>` Release。公开文件不可覆盖；失败后复用回执与摘要一致的候选。

Play 上传完成不等于审核通过。索引记录 `processing`；可选的商店状态任务使用 Reporting API 的实际 `servingReleases` 确认可用，不把编辑接口的 `completed` 当作上架证据。iOS 状态直接在 Apple 平台查看。

所有原生动态包包含 UI 与匹配内核，按渠道、契约和 track 隔离。下载后下次冷启动试运行，等待恢复、实际页面渲染和原生目录读取后确认。未确认包下次启动回退，最高 revision 保留；回滚代码需以更高 revision 重新发布。后台只执行已确认内核，编辑会话不强制重载，桌面安装前等待未完成提交。

`release-index` 是数据分支，客户端读取签名的 `<stable|preview>/<渠道>.json`。并发提交采用非强制 CAS 合并，保留其他平台。启动检查限频六小时，手动检查可绕过缓存；离线使用最近认证的本地记录。

## 凭据与权限

质量检查保持只读，发布 Actions 固定 SHA；外部 PR 不接触签名或发布密钥。保护版本标签，环境只允许 main 与版本标签，初次配置记录见[云端接入](release-setup.md)。

| 位置                   | 凭据                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库公开变量           | `TIO_RESOURCE_PUBLIC_KEY`、`TIO_UPDATER_PUBLIC_KEY`、`APPLE_TEAM_ID`、预期签名证书摘要                                                                           |
| Xcode Cloud            | 公开 `TIO_RESOURCE_PUBLIC_KEY`；Apple 签名由 Cloud 管理，无 GitHub 写入凭据                                                                                      |
| `android-play-build`   | `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`                                                              |
| `android-play-publish` | Play 构建所用的同一组签名凭据，以及 `ANDROID_PLAY_SERVICE_ACCOUNT_BASE64`；公开 `TIO_ANDROID_PLAY_UPLOAD_CERT_SHA256`                                            |
| `macos-direct-build`   | `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`；Tauri 更新私钥及密码；公开 `APPLE_SIGNING_IDENTITY`、`APPLE_CERTIFICATE_SHA256` |
| `windows-direct-build` | `WINDOWS_CERTIFICATE_BASE64`、密码和摘要；Tauri 更新私钥及密码                                                                                                   |
| `linux-direct-build`   | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                                                                                                |
| `release-publish`      | `TIO_RESOURCE_PRIVATE_KEY_BASE64`；可选的 Play 只读状态凭据                                                                                                      |
| `web-release`          | 同一索引签名凭据、Cloudflare account ID 与 Pages 部署 token                                                                                                      |

macOS 的 `APPLE_PASSWORD` 是专用于公证的 Apple App 专用密码，不是 Apple 账户登录密码。Play 服务账号只授权 Tio 应用所需轨道，不授予其他应用、财务或 Google Cloud 项目角色。私钥仅解码到 runner 临时目录；完成后清理，不进入日志或公开资产。

启用统一发布前须关闭 Pages 原有 Git 自动构建，以免合并 main 就部署生产。保留 Pages 项目、域名和独立鉴权 Worker。0.2.0 前不兼容旧更新协议，不增加旧格式迁移或兼容入口。
