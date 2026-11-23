# 发布与更新

所有平台使用同一份发布计划，平台之间独立完成构建、验证和发布。原生安装包、动态应用包、内容包和 Web 部署是不同产物，不使用 GitHub Latest Release 作为更新入口。

## 版本与兼容性

根目录 `package.json.version` 是产品版本，对应源码标签 `vX.Y.Z` 或 `vX.Y.Z-rc.N`。原生包的宿主版本与构建号只在实际构建安装包时准备，不要求所有平台同步升级宿主。

`apps/native/release-plan.json` 声明：

- `revision`：动态包的递增版本号，须高于目标渠道上次成功发布的 `releaseRevision`。
- `hostBuild`：原生构建号；构建宿主时必须同时高于该平台稳定、预览两个渠道已经发布的构建号。商店中已有但尚未完成本次发布的候选包复用原始二进制。
- `forceHost`：需要主动重打安装包时声明渠道数组；只允许升级为宿主更新，不允许用它绕过兼容检查。
- `storeNotes`：按商店渠道维护当地语言的更新说明，iOS 对接已配置的商店语言，Play 写入对应 release notes。
- `targets`：`auto` 或渠道数组。可选 `ios-store`、`macos-direct`、`windows-direct`、`linux-direct`、`android-play`、`android-apk`、`web`。
- `ios.intent` 和 `ios.reason`：区分已有行为修复与需要审核的功能变动。CI 不根据文件扩展名自动推断商店政策。
- `compatibility.storage`、`compatibility.bridge`：`unchanged`、`compatible` 或 `breaking`。协议实现输入变化时必须明确声明，并填写 `compatibility.reason`；不兼容变更还必须增加对应契约版本。
- `web.deployment`：`tag` 默认随标签自动部署；`manual` 仅通过手动发布入口部署。
- 可选 `content.translations`：仓库内的翻译覆盖 JSON，用于只更新已知翻译键。

`apps/native/host-contract.json` 定义桥接版本、持久化格式版本、能力集合、目标 JS 引擎和 iOS 审核基线。规范化后生成 `contractId`。宿主源码指纹与契约 ID 分开记录：原生修复需要新安装包，但多个兼容宿主构建可以共用动态包。

| 改动                                          | 发布结果                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| 兼容的界面、编辑器、TypeScript 内核与同步逻辑 | 动态应用包                                                              |
| 声明的已有翻译键覆盖                          | 内容包，绑定已发布运行时资源版本                                        |
| Rust、Swift、Kotlin、原生插件、权限或构建输入 | 对受影响平台构建宿主，并附带对应应用包                                  |
| 持久化或桥接协议不兼容                        | 增加契约版本，发布新宿主                                                |
| iOS 新功能                                    | 增加 `reviewEpochs.ios-store`，走商店；旧宿主不能收到该审核基线的新功能 |
| Web                                           | 构建独立站点，部署到现有 Cloudflare Pages                               |
| 文档、测试或发布工具自身变化                  | 不自动更新客户端                                                        |

判定比较各平台上次成功发布的基线，不比较仓库最近一个标签。运行时代码按 Web、原生入口的工作区依赖闭包计算，锁文件变化保守视为共享构建输入。Android Kotlin 改动不会单独触发 iOS 重建；共享 Rust 改动保守影响使用它的宿主。数据契约与桥接输入指纹用于发现需要人工分类的改动，不以指纹判断业务语义是否兼容。

Apple 的解释执行代码仍受用途、权限和审核限制，不能把“纯 JS”当作绕过商店的依据。参见 [Apple 审核规则](https://developer.apple.com/app-store/review/guidelines/)与[开发者协议](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)。Play 动态包不包含 dex、JAR 或原生库，参见 [Google Play 政策](https://support.google.com/googleplay/android-developer/answer/16559646)。

## 发布入口与失败恢复

`Release` 工作流自动响应版本标签，也可手动选择已存在的标签和渠道。手动运行默认只验证和保留产物，勾选 `publish` 才执行发布。工作流要求源码提交属于 `main` 历史，完整质量检查成功后才进入签名与发布流程。

本地预览构建矩阵：

```sh
node apps/native/release/fetch-baselines.mjs --out tests/tmp/release/baselines
node apps/native/release/plan.mjs --baseline tests/tmp/release/baselines --out tests/tmp/release/plan.json
node apps/native/release/plan.mjs --baseline tests/tmp/release/baselines --targets android-apk,web
```

读取已有基线时提供仓库配置的公开 `TIO_RESOURCE_PUBLIC_KEY`。正式发布前提交产品版本、计划 revision、需要的 hostBuild 和兼容性声明；不要在流水线中临时选择最新依赖版本。Chaty 使用 package.json 和锁文件中的 npm 精确版本，安装统一使用 frozen lockfile。

每个平台经过以下阶段：

1. 复用已经公开或已完整暂存的同版本产物；不存在时才构建。
2. 校验原生签名、版本与校验和，保存到该平台的 GitHub Draft。失败后重试优先复用候选，避免重新打包改变商店二进制。
3. 商店渠道执行上传与提交；元数据、截图、隐私及审核资料须已在商店配置好。首次商店初始化仍由账号所有者完成。
4. 独立签名任务校验候选回执、动态包契约和内容键，再签署动态清单。公开前核对 GitHub 上实际资产摘要，清除不属于最终清单的 Draft 附件。
5. 公开该平台的 `dist/<产品版本>/<渠道>` Release，再更新签名索引。其他平台失败不阻塞这一平台。

已公开产物不可覆盖。补跑只允许同一个源码标签和相同摘要；不同二进制须使用新版本。公开成功而索引提交失败时，重跑复用已公开产物并重试索引，不重新签包。

## 分发、激活与回滚

`release-index` 是只存放生成文件的分支，客户端读取：

```text
https://raw.githubusercontent.com/glink25/tio/release-index/<stable|preview>/<渠道>.json
```

索引本身签名，包含最新宿主状态、按契约选择的动态包，以及按运行时资源版本选择的内容包。资源地址固定到具体 GitHub Release，归档文件名包含哈希。更新索引使用 Git 提交的非强制更新；并发冲突重新读取最新树合并，保留未选平台。索引部署序号和动态包 revision 独立：商店状态变化不会回退产品版本或覆盖较新的动态包。

稳定版本使用 `stable`，RC 构建使用 `preview`。未安装预览宿主的稳定客户端不会接收预览索引。客户端启动检查限频六小时，手动检查可绕过时间缓存；断网保留上次认证的索引和本地确认版本。

所有原生端支持动态应用包。UI 与配套无界面内核一起校验、暂存，在下一次启动时以跨进程排他锁切换。确认需等待宿主完成初始恢复、页面实际提交渲染，并检查应用契约与原生目录读取。后台只能执行已确认内核。编辑会话不自动重载，安装宿主前会等待当前运行时提交完成。

试运行未确认时，下次启动恢复上一确认包；最高 revision 不回退。宿主内置的应用版本还设定最低动态 revision，新安装包不会被旧缓存覆盖。运营回滚须用更高 revision 重新发布旧代码，并保持目标契约兼容，不能重复投递被拒绝的旧清单。

商店上传成功只记录 `processing`。`Store availability` 工作流每六小时读取结构化商店状态：iOS 以 App Store 的 `READY_FOR_DISTRIBUTION` 或 TestFlight 的实际测试状态确认；Play 以 Reporting API 的 `servingReleases` 中的目标版本确认，不把编辑接口的 `completed` 当作审核通过。商店状态只修改当前匹配宿主，不重写已公开二进制。参见 [Apple 状态说明](https://developer.apple.com/documentation/appstoreconnectapi/webhook-events)和 [Play Serving Releases](https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/fetchReleaseFilterOptions)。

## 发布环境配置

质量检查与普通构建保持仓库只读权限，外部 PR 不接触发布密钥。Actions 全部固定到提交 SHA。保护版本标签，发布环境只允许正式仓库的 `v*` 标签和用于受校验手动发布的 `main`。按标签自动发布时不设置每次必需人工晋级的审核人。

仓库公开变量：`TIO_RESOURCE_PUBLIC_KEY`（32 字节 Ed25519 公钥的 Base64）、`TIO_UPDATER_PUBLIC_KEY`（Tauri 公钥）、`APPLE_TEAM_ID`、App Store Connect 的 app、SCM repository 和两个 Xcode Cloud workflow ID，以及独立 APK 与 Windows 的预期证书 SHA-256。公钥在计划、构建和发布环境中必须一致。

| 环境                                       | 用途与凭据                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `windows-direct-build`                     | Windows PFX、密码、证书摘要；Tauri 更新签名私钥与密码              |
| `linux-direct-build`                       | Tauri 更新签名私钥与密码                                           |
| `android-play-build` / `android-apk-build` | 各自的 keystore、密码和别名；两渠道保留不同应用 ID                 |
| `ios-store-build` / `macos-direct-build`   | 触发 Xcode Cloud 的 ASC API key；macOS 校验更新签名公钥            |
| `ios-store-publish`                        | 提交审核的 ASC API key 与 `ASC_APP_ID`                             |
| `android-play-publish`                     | Play 上传服务账号 `ANDROID_PLAY_SERVICE_ACCOUNT_BASE64`            |
| `release-publish`                          | `TIO_RESOURCE_PRIVATE_KEY_BASE64`；商店状态使用单独的只读 API 凭据 |
| `web-release`                              | 相同的索引签名凭据、Cloudflare Pages 编辑/部署 token 和 account ID |

Windows 凭据名为 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`、`WINDOWS_CERTIFICATE_SHA256`。Android 使用 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`；独立 APK 发布还需 `TIO_ANDROID_APK_CERT_SHA256`。私钥只解码到 runner 临时目录，不进入上传目录。

ASC 使用 `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_PRIVATE_KEY_BASE64`；公开 ID 为 `ASC_APP_ID`、`ASC_SCM_REPOSITORY_ID`、`ASC_IOS_WORKFLOW_ID`、`ASC_MACOS_WORKFLOW_ID`。监控环境使用 `ASC_READ_*` 和 `ANDROID_PLAY_READ_SERVICE_ACCOUNT_BASE64`。Play Reporting 的 `PLAY_PRODUCTION_TRACK_TYPE`、`PLAY_PREVIEW_TRACK_TYPE` 按账号实际 API 返回的结构化 `type` 配置，不按本地化展示名称猜测；未配置时不宣布可用。

Xcode Cloud 使用两个独立的归档工作流，只接受受信任版本标签，不为外部 PR 启用签名环境。iOS 配置 TestFlight 上传动作，macOS 配置 Developer ID 导出和双架构。Cloud 环境配置公开更新公钥，以及公证密钥、Tauri 签名私钥。回传 Draft 产物使用仅安装在 Tio 仓库、具有 contents write 权限的 GitHub App：`TIO_GITHUB_APP_ID`、`TIO_GITHUB_INSTALLATION_ID`、`TIO_GITHUB_APP_PRIVATE_KEY_BASE64`。Actions 核对 Cloud 实际源码提交、构建号和签名团队后才接收回传。

Web 的 `web.deployment: tag` 随正式标签部署生产，RC 部署 Pages 预览分支；设为 `manual` 时，在同一个 `Release` 工作流指定 `targets=web` 并启用 `publish`。启用这套策略前先关闭现有 Pages 的 main 自动构建，避免合并发布代码时仍触发旧链路；部署任务也会检查并关闭 Git 集成自动构建，防止后续出现另一条生产发布链。保留项目、域名和独立鉴权 Worker，不迁移到 Workers 静态资源托管。

这些账号、密钥、商店元数据和云端工作流必须完成一次性配置后才能运行真实发布。仓库代码不会伪造签名、跳过缺失配置或把构建成功当作商店已上架。0.2.0 前不兼容旧更新协议，不增加旧清单读取或数据迁移分支。
