# 云端发布接入

2026-11-23 确认的分发方式：iOS 使用 App Store／TestFlight，macOS 使用签名、公证的 DMG，Android 使用 Google Play；不向 GitHub Releases 上传 IPA、AAB 或独立 APK。Windows、Linux 提供直接下载安装包。Web 保留 Cloudflare Pages。原生动态包与商店宿主安装包分别发布。

Xcode Cloud 直接读取 GitHub，按 iOS 宿主标签自动归档。macOS 通过 Actions 构建通用 DMG。GitHub Actions 不调用 Apple API 触发构建，也不创建用于回传安装包的 GitHub App。iOS 签名、商店上传与分发由 Xcode Cloud 管理。

Google Play 使用 Actions 构建并签署 AAB，由 Google Play Developer API 上传内容库并更新选定的测试／发布轨道。首次 Play App Signing 与服务账号的应用权限需在控制台建立；日常发布不手动上传。

## 已建立的记录

| 项目                  | 配置                                                               |
| --------------------- | ------------------------------------------------------------------ |
| GitHub                | `glink25/tio`，原生实现 PR #6                                      |
| Apple 团队            | `SQFK9H53PK`（Jun Zhou）                                           |
| Apple Bundle ID       | `com.glink25.tio`                                                  |
| App Store Connect     | `6838149856`，`Tio - Documents & Databases`，iOS 与 macOS          |
| Play 应用             | `com.glink25.tio`，控制台应用 ID `4972445025917771071`             |
| Play 上传证书 SHA-256 | `2a0bbb6517f1ab2f7177c161a7c7de936060df185188de5aa8ddfaccd16839c2` |

生产密钥在本机 `~/Library/Application Support/Tio Release/` 受限目录及所需的云端 Secrets 中保管，未纳入 Git；该目录需由维护者另行安全备份。GitHub 已配置 Play 上传证书、动态包签名密钥和桌面更新签名密钥。此前为独立 APK 准备的密钥不再用于发布。

## 接入状态

Play 已接受使用正式上传证书签名的 0.1.0／1001 首包，并保存为内部测试草稿。Tio 专用服务账号 `tio-play-publisher@cent-play.iam.gserviceaccount.com` 已绑定该应用的读取及测试轨道发布权限。访问令牌和应用级权限已通过 Play API 验证。发布工作流使用 `android-play-publish` 环境中的凭据。

`v0.1.0-rc.3` 的 Actions 构建自动将 1004 号 AAB 上传 Play。Play API 确认内容库和 `internal` 轨道均有该构建，轨道状态为 `completed`。正式发布仍需账号取得生产权限。

Xcode Cloud 工作流 `Tio iOS Host` 已启用宿主标签自动归档。App Store Connect 中的 macOS 平台草稿未提交，macOS 分发使用 GitHub Actions。`macos-direct-build` 已配置 Developer ID 证书与公证凭据。`v0.1.0-rc.5` 已通过应用与通用 DMG 的公证验证，[可从 GitHub Release 下载](https://github.com/glink25/tio/releases/tag/dist/0.1.0-rc.5/macos-direct)。

`host/ios-store/v0.1.0-rc.6` 自动触发 Xcode Cloud Build 5。App Store Connect 已接收 `0.1.0 (5)` 并标记上传完成。TestFlight 分发前需完成应用加密声明。iOS 原生 HTTPS 请求使用 Rustls，按 App Store Connect 表单选择标准加密并据实际分发地区填报。法国分发需要上传相应声明文件。参见 [Apple 出口合规说明](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/)。

Pages 已关闭旧的 main 自动构建，保留当前生产部署。
