# 原生宿主开发

Web 与原生薄入口分别位于 `apps/web` 和 `apps/native`，共享 React 应用位于 `packages/app`。无界面原生内核位于 `packages/native-core`。使用 Node.js 24、仓库固定的 Rust 1.93.1 和平台 SDK。安装依赖执行 `corepack pnpm install --frozen-lockfile`。CI 使用 `node scripts/install-ci.mjs` 按已提交锁文件安装 npm 发布的 Chaty，不在流水线中改写依赖版本。发布策略见[发布与更新](releases.md)。

## 本地构建

macOS 安装 Xcode，Android 安装 Android SDK、NDK 与 JDK。Tauri CLI 会报告缺少的平台依赖。

- 桌面运行 `corepack pnpm --filter @tio/native exec tauri dev`。
- 桌面构建运行 `corepack pnpm --filter @tio/native exec tauri build`。
- iOS 模拟器构建运行 `VITE_TIO_CHANNEL=ios-store corepack pnpm --filter @tio/native exec tauri ios build --debug --target aarch64-sim`。
- Android 调试包构建运行 `VITE_TIO_CHANNEL=android-play corepack pnpm --filter @tio/native exec tauri android build --debug --apk --target aarch64`。

Android 仅保留 Google Play 渠道和 `com.glink25.tio` 应用 ID，授权回调为 `tio://auth/github`。不提供独立 APK 分发或安装权限。前端构建输出按平台存放于 `apps/native/dist`。

## 持久化与快捷指令

设备空间、连接目录、GitHub 编辑副本、同步基线和远端文件缓存使用 SQLite。文件夹空间使用共享文件编解码与恢复日志，端点标识使用授权 ID。Apple 授权通过安全作用域书签恢复，Android 使用持久目录 URI 授权。

iOS 的读取、创建和追加 App Intent 调用 JavaScriptCore 中的共享无 DOM 内核。调用参数包括连接 ID、空间 ID 和稳定文档 ID。文件夹连接 ID 使用前台选择目录时生成的 `folder-…` 标识。成功结果表示仓库提交已确认。GitHub 空间使用匹配连接、空间和绑定端点的原生编辑副本，不完整的副本返回 `pending`，已关闭的空间返回 `closed`。追加或创建后申请后台同步机会，实际发布仍遵循空间的手动同步策略。

## 全平台动态更新

所有原生端将 React 前端、资源与无 DOM TypeScript 内核打成同一个签名包。前台 WebView 和后台 JavaScriptCore / QuickJS 通过同一原生存储桥接执行业务。`contractId` 表示原生桥接、持久化格式、能力、引擎和审核基线；只有明确兼容的契约才能独立于宿主更新。原生能力、权限、依赖和数据契约变化需发布新宿主。

构建时提供 `TIO_RESOURCE_PUBLIC_KEY`，内容为 Base64 编码的 32 字节 Ed25519 公钥。私钥由发布环境保管。先构建共享内核，再以目标 `VITE_TIO_CHANNEL` 构建 native 前端。Vite 输出 `native-contract.json` 和对应的 `native-kernel.js`。执行 `node apps/native/updates/frontend-pack.mjs --channel <渠道> --dir <前端目录> --revision <递增整数> --private-key <私钥文件> --out <包目录>`，打包器检查内核一致性并签名。

宿主从 `release-index` 分支按渠道读取签名索引，按契约选择动态包。清单绑定产品版本、兼容契约、revision、运行时资源版本、内核及所有文件的哈希，不再绑定单个宿主构建号。资源地址固定到平台独立 Release，归档名包含 SHA-256。宿主拒绝错误渠道、签名、链接和越界路径。翻译覆盖包由 `resource-pack.mjs` 生成，绑定匹配运行时资源版本的已知键。未配置公钥的构建关闭更新。

下载完成只记录待启用包。应用下次冷启动时试运行，宿主完成初始恢复、页面实际渲染并通过契约与目录读取检查后确认；试运行未确认，下次启动恢复已确认包。回退保留最高更新序号，避免重复试运行失败版本。包目录按内容哈希存储，启动时清理无引用缓存。正在编辑的会话不会强制重载。

后台只执行已确认包中的内核。每次任务持有跨进程共享文件锁；前台切换版本需要独占锁，并通知可中断后台任务退出。五秒内未能取得锁时，前台使用已确认包并保留待启用版本。试运行期间阻止新后台任务进入，确认后释放独占锁。进程被终止时系统释放文件锁。这样一次任务执行期间使用同一份内核，前后台不会跨版本并发提交。Android 文件锁使用 `fs2` 的 Unix 实现，避免当前 Rust 标准库在 Android 上不支持文件锁的问题。

Android 与 iOS 宿主更新走商店；macOS、Windows、Linux 使用已签名的桌面安装包更新。热更新包的发布仍需遵守对应商店对可下载内容的要求。

## 当前验收记录

2026-11-21 本地通过 Web 完整检查、Rust 编译检查，以及 iOS 模拟器和 Android 调试包构建。Android 模拟器中验证了 SQLite 副本的重复提交、强制停止后恢复、同步基线和未知字段保留。临时事务验证还覆盖版本冲突和空间隔离。Apple JavaScriptCore 克隆实现验证了附件字节数组、共享缓冲区、循环引用和未知值保留。

iOS 已注册 BGProcessingTask，进入后台后向系统申请网络同步机会。任务从原生目录读取空间与端点，通过 Keychain 读取匹配身份的凭据，以共享 TypeScript 内核执行同步。后台与前台通过同一个跨进程凭据锁执行令牌读取、刷新和回写。刷新使用编译时授权服务配置，保持原用户身份。刷新凭据过期时等待重新授权，限流重试时间落入 SQLite，系统取消会中断当前执行。前后台发布使用同一文件锁路径。模拟器已验证无 WebView 进程读取实际 SQLite 目录并完成空任务批次，安装包包含后台任务许可声明。系统实际唤醒和真实 GitHub 同步仍待验收。

Android 已接入 WorkManager 和 QuickJS Kotlin 运行时，应用进入后台时申请一次同步，并保留由系统调度的周期任务。后台通过 JNI 使用共享 Rust SQLite 桥接与跨进程发布锁。Pixel Tablet 模拟器（Android 15）已验证 WorkManager 加载内核、读取原生目录并成功提交空批次回执。结束应用进程后，通过系统 JobScheduler 调试命令触发保留的任务，系统创建新进程，在未打开应用界面的情况下再次成功执行，Worker 日志耗时约 445 毫秒。后台进程诊断显示 WebViews 为 0，PSS 约 60 MB，RSS 约 93 MB，数值来自该模拟器空批次执行后的进程快照。该结果验证后台冷启动链路，系统自然调度和真实远端读写仍待验收。内核包含标准 Intl 补充实现，供 QuickJS 进行 Unicode 文本合并和时区验证。真实远端同步与系统中止恢复仍待验收。

移动热更新已在 Android 模拟器中通过真实桥接提交签名包，验证新 React 前端启动、文档保留，以及 WorkManager 执行包内新内核并写入版本与哈希回执。损坏签名和不匹配内核清单均被拒绝。iOS 模拟器通过预置签名缓存验证启动校验和确认，并在独立 JavaScriptCore 验证进程中执行相同更新内核；该结果不包含 iOS 网络下载与系统快捷指令调用。iOS 的前台生命周期同时监听应用与场景激活，后台启动时延迟创建 WebView。

iPhone 18 Pro 模拟器（iOS 27.2）已从系统“快捷指令”实际执行读取、追加和创建文档三个操作。测试先终止 Tio，将稳定连接、空间和文档 ID 传给操作；返回 `persistence: confirmed`，SQLite 中从四个块变为五个，追加文本与输入一致。读取操作返回了含追加段落的完整文档；创建操作返回确认回执，SQLite 中核对新文档标题与正文一致。该系统调用测试使用预置的设备空间，未覆盖 iCloud 授权。另在独立 JavaScriptCore 验证进程中检查 GitHub 本地副本追加、原块无损、不完整副本拒绝和已关闭空间拒绝。

iOS 模拟器还验证了跨进程版本切换：持有后台读锁时前台保留已确认版本和待启用包，未确认试运行阻止新后台任务进入，终止重开后恢复前端与内核的已确认版本。

真实 iCloud 多设备并发、真实 OAuth、桌面签名更新、Windows/Linux 运行和发布升级演练仍需完成验收。构建通过仅代表本地编译结果。本次未执行发布流水线。

## 桌面更新清单汇集

桌面宿主要求更新签名绑定实际应用版本。发布环境分别配置公开的 `TIO_UPDATER_PUBLIC_KEY` 和受保护的 `TAURI_SIGNING_PRIVATE_KEY`。资源包公钥与宿主更新公钥分别管理。

`apps/native/release` 工具读取同一平台的产物索引、更新包及 `.sig` 文件。索引含 `version`、`channel` 和 `artifacts`；每个产物包含 `target` 和 `file`。macOS 通用包要求两个 Darwin 架构，Windows、Linux 各自验证对应目标，不再要求等待其他平台。

设置 `TIO_UPDATER_PUBLIC_KEY` 后，执行 `cargo run --manifest-path apps/native/release/Cargo.toml -- artifacts/artifacts.json artifacts/verified`。工具验证 Minisign 签名及绑定版本，生成独立的 `desktop-updates.json` 和 `SHA256SUMS`，下载地址绑定 `dist/<版本>/<渠道>` Release。

此工具已通过本地编译与临时签名夹具验证：Windows 单平台清单、绑定版本签名、手动工作流的分支上下文及文件篡改拒绝。夹具不是 Windows 安装包；正式签名产物汇集、安装升级和发布流水线仍需实际演练。

## Apple 工程与构建版本

Xcode 工程包含 `tio-native_iOS` 和 `tio-native_macOS` 两个共享 scheme。Xcode Cloud 仅为 iOS 建立标签触发的工作流；macOS 的正式 DMG 在 Actions 构建、签名与公证。macOS target 链接共享 Rust 宿主，归档配置支持 arm64 和 x86_64，调试配置构建当前架构。

产品版本取自根目录 `package.json`。Android 与桌面的构建号取自 `release-plan.json.hostBuild`；Cloud iOS 使用其自增的 `CI_BUILD_NUMBER`。需要新宿主时，流水线执行 `node apps/native/version.mjs --prepare-host`，将该平台本次安装包信息写入原生 package 元数据；Apple 再以 `--prepare-apple` 生成 `Version.xcconfig`。Android 从准备后的原生元数据读取版本。Apple 展示版本去掉 RC 后缀，完整候选版本仍保留在 Tauri 包信息和签名中。源码标签对应产品版本，各平台无需同时更新宿主。

本地 Xcode 构建 macOS 前，先执行上述版本准备命令和 `corepack pnpm --filter @tio/native build --outDir dist/desktop`，再构建 `tio-native_macOS` scheme。调试产物使用内置资源协议，无需启动开发服务器。

本地 arm64 Xcode 构建已通过，实际界面完成了设备空间创建、页面标题编辑、保存与退出重启验证。验收创建的本地空间为 `Native Xcode QA`，共享宿主重构后的页面标题为 `Native shared host persistence`。macOS 包和 Android 包均已核对版本 `0.1.0`、构建号 `1001`。另以 `ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO` 完成本地调试构建，实际可执行文件经 `lipo -archs` 核对包含两个架构。此结果不代替 Developer ID 签名、公证归档和 Xcode Cloud 验收。

macOS 的正式构建使用 Actions 中的 Developer ID 证书与 App 专用公证密码，生成通用 DMG 和绑定版本签名的 Tauri 更新包。发布前核对应用版本、两种架构、实际证书、公证及 DMG 票据。本地 Xcode scheme 保留作为调试入口，不用于云端正式发行。

## 后续实现与验收

- 共享应用已独立为 `@tio/app`，后续平台能力通过 `AppPlatform` 注入，不再从 Web 入口构建原生应用。
- Android 本地 SAF 已验证中断发布恢复；其他文档提供方、真实云端文件夹与多设备并发仍需验收。
- 验证前台未确认输入与快捷指令并发、中文输入法、软键盘遮挡、选区、返回和预测返回手势。
- 在真实授权的 iCloud 目录完成冷启动快捷指令读写、撤销授权、离线下载等待和多设备冲突；模拟器设备空间结果不能代替此验收。
- Windows GNU 目标的 Rust 编译检查已通过，仍需对应系统上的 MSVC 构建、安装与运行；继续完成 Linux 构建运行、macOS 正式归档、签名更新升级演练及各渠道发布汇集。发布流水线已按独立平台策略改造；远程签名与发布尚待配置凭据后演练。Chaty 使用 npm 发布版。
- 部署后的真实 GitHub OAuth、原身份恢复和远端后台同步仍待验收；本次未部署授权服务或发布产物。

## 桌面标题栏

VS Code 在同一行放置工作区控件及系统窗口按钮，并允许 Linux 用户使用系统窗口框。Firefox 也将标题栏独立设为可选。Tio 沿用现有工作区工具栏和快捷键，系统窗口按钮由各平台负责。 [VS Code 窗口配置](https://github.com/microsoft/vscode/blob/main/src/vs/platform/windows/electron-main/windows.ts) · [VS Code Linux 行为](https://code.visualstudio.com/updates/v1_98) · [Firefox 工具栏设置](https://support.mozilla.org/en-US/kb/customize-firefox-controls-buttons-and-toolbars)

- macOS 使用 Tauri 的 Overlay 标题栏。工作区栏给红绿灯留出空间，空白区域支持拖动，系统菜单提供「新建窗口」。 [Tauri 窗口自定义](https://v2.tauri.app/learn/window-customization/)
- Windows 通过 DWM 将内容延伸到标题区，保留原生窗口按钮。WebView2 的可拖动区域处理标题栏拖动、右键系统菜单和双击。高对比度启动或无法扩展窗口框时使用系统标题栏。 [Microsoft DWM 窗口框](https://learn.microsoft.com/en-us/windows/win32/dwm/customframe) · [WebView2 可拖动区域](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings9) · [Windows 11 贴靠布局](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
- Linux 在 GTK 窗口显示前装配原生 `GtkHeaderBar`。窗口按钮位置沿用桌面环境设置，原生栏提供侧栏开关与新建窗口入口，文档导航和编辑操作沿用工作区。 [GTK HeaderBar](https://docs.gtk.org/gtk3/class.HeaderBar.html) · [GTK 标题栏安装](https://docs.gtk.org/gtk3/method.Window.set_titlebar.html)

桌面验收覆盖窄窗口、浅色和深色、全屏、切换侧栏、双击标题栏、系统菜单、窗口缩放和系统窗口按钮。Windows 11 额外验证贴靠布局、高对比度和跨显示器 DPI。Linux 分别验证 GNOME、KDE 及 Wayland、X11 的按钮布局和窗口控制。

本次在 macOS 调试宿主的隔离应用数据中验证了真实窗口和 WebView 布局、不同空间分窗、重复打开同一空间、关闭时保留另一窗口的锁，以及关闭后重开。Windows GNU 目标通过 Rust 交叉编译检查，Linux ARM64 在 Debian 的 GTK 和 WebKit 环境通过 `cargo check --locked`。

本次在 iPad 模拟器的原生场景中验证了双窗口空间隔离、重复打开时聚焦已有场景、重载时按窗口隔离锁，以及关闭背景场景后保留原窗口路由。Android API 35 模拟器验证了原生开屏失败后的重试和系统返回键。macOS 系统窗口按钮与菜单、iOS 键盘辅助栏、Windows 11 贴靠布局和 Linux 不同合成器下的窗口操作待手动验收。

## Android 文件夹可恢复发布

SAF 写入先持久化底层发布日志，再写唯一命名的临时文件，核对哈希后将旧文件重命名为备份、临时文件重命名为目标。完成后清理备份和日志。权威文件不会被截断写入。提供方须支持文档重命名；不支持时拒绝发布，保留已有文件。

底层日志存放于应用的 `noBackupFilesDir/folder-writes/<授权 ID>/<空间 ID>/`，使用 Android `AtomicFile` 持久化。锁和恢复按空间隔离。日志只记录文件发布状态，业务命令、提交回执和完整事务恢复继续由共享 `FileRepository` 管理。没有另建业务保存队列。目标文件的外部变更不能自动覆盖；遇到冲突时保留目标、旧备份、暂存文件与日志，并返回结构化 `conflict`。用户明确移除空间时，删除该空间及其底层日志。

暂存文件使用 `.tio-publish-<UUID>.tmp`，备份使用 `.tio-before-<UUID>.tmp`。这些名称只用于发布期间的恢复，不进入 Tio 对象索引。恢复中已完成的发布只清理残留物；不完整暂存保留旧目标，由工作空间事务日志重试。初次写日志时被终止而留下的孤立 `.new` 文件不会阻塞后续读写。

本地使用已持久授权的 Android ExternalStorage 文档提供方验证：写入 16 MB 文件暂存期间强制停止 Tio，重开后恢复完整文件，SHA-256 与原请求一致，临时文件和日志已清理。另通过一次性故障状态验证重命名空档恢复、不完整暂存回退、外部修改保留、初次日志写入中断，以及同一授权下两个空间的恢复隔离，以及用户明确移除冲突空间后清理其发布日志。共享文件夹恢复的 7 个既有长期用例通过。以上结果来自 Android 15 模拟器和本地文档提供方，未覆盖 Google Drive 等云端提供方。

## 共享宿主拆分验收

共享应用已迁入 `packages/app`，导航、设置、连接选择、同步状态、弹层和编辑器编排由同一实现负责。`AppPlatform` 在挂载前注入平台能力，Web 和原生均有独立薄入口、HTML 与 Vite 构建配置。原生目录与凭据实现不进入 Web 包；无界面命令、原生仓库协议和后台同步迁入 `packages/native-core`，不依赖应用入口或界面包。Chaty 的 npm 安装归属调整为共享应用包，未运行发布流水线。

本次完整检查、144 项单元测试与 10 项浏览器端到端测试通过，独立原生前端、Android APK、iOS 模拟器和 macOS Xcode 构建通过。macOS 实际编辑标题为 `Native shared host persistence`，退出重开后保留。iOS 共享入口打开此前设备空间内容，系统快捷指令在新内核中创建文档并返回确认回执。此前本地 QA 热更新前端包已从该模拟器的测试元数据中移除，保留工作空间数据，以确保验收到新的独立原生入口。

退出时先停止编辑和同步，再以排他内核锁等待后台任务退出，清除原生目录、私有工作空间、副本、凭据与授权；外部文件夹保持不变，签名应用资源及防回放状态保留。即使关闭热更新，后台内核也使用读锁参与此协调。Android 独立 APK 的私有测试空间验证了清理前有一项会话，清理后会话、对象和验收设置均为空。实际撤销已授权云端目录及跨进程清理争用仍待专项端点验收。

## Linux 本地宿主验证

在本机 Colima 的 Debian 12 arm64 容器中，以 Rust 1.93.1、WebKitGTK 4.1 构建原生宿主，并通过官方 `tauri-driver` 驱动 Xvfb 中的真实 WebKitGTK 窗口。创建 `Native Linux QA` 设备空间，经编辑器键入标题 `Native Linux persistence` 和正文，确认本地保存后关闭进程；新进程恢复了相同标题和正文。容器补装 Noto CJK 系统字体后核对中文显示。此结果不是浏览器模拟，也未使用发布流水线。

另在隔离的临时目录预置一项授权记录，通过实际原生桥接完成文件写入、替换、读取、列举、删除，并核对目录穿越请求被拒绝。此验证覆盖 Linux 原生文件 I/O，但没有经过系统目录选择器，也未覆盖安装包、真实云端文件夹或签名更新。

## 移动端导航与弹层

iOS 和 Android 的内容导航使用内存路由。模态、窄屏侧栏抽屉和设置子页使用临时 hash 历史，实际呈现为模态的选择器只登记一次。Android 仅在有模态可返回时拦截系统返回，由前端执行逐层遍历与草稿保护。所有模态关闭后交还系统。原生窄屏的侧栏和页面型模态共享侧滑交互。移动 WebView 由宿主关闭整页捏合缩放，文本选择仅在输入和正文编辑区启用。Web 和桌面宿主沿用内容链接及浏览器历史。

改造前，在 Android 15 Pixel Tablet 模拟器验证了系统返回按键逐层关闭外观选择与设置、系统边缘手势只关闭当前层，以及根界面返回和重新打开。

## 独立平台发布与动态包验收

2026-11-22，本地完整 `corepack pnpm check` 通过，包含 144 项单元测试；共享应用启动确认改动后的 10 项浏览器端到端测试通过。Rust 宿主与桌面签名汇集工具检查通过，Actions 经 actionlint 检查。临时发布夹具验证了平台独立判定、iOS 审核基线、协议兼容声明、跨稳定/预览的构建号、Web 自动/手动策略、同版本重试，以及模拟 GitHub 索引并发提交保留其他平台。临时夹具不代表远程 Actions 执行。

Android 15 Pixel Tablet 的新宿主通过真实桥接暂存 revision 3001 的签名应用包；重启确认前端后，WorkManager 执行同包 QuickJS 内核并写入版本标记。revision 3002 的故障前端未确认，下一次重启恢复 3001，最高序号仍保留；以更高 revision 3003 重新发布正常代码后确认成功。错误渠道、契约、低于内置基线的版本、损坏归档和签名均返回对应结构化拒绝结果。结束后仅移除该私有 QA 渠道的验证更新与标记，没有清理 Play 包。

macOS 本机 arm64 Xcode 构建通过。预置签名 revision 4001 缓存后，实际应用显示动态包标记，SQLite 记录为已确认且无待试运行包，原有 `Native shared host persistence` 文档完整保留。移除该 QA 缓存后重启，标记消失且原文档仍在。这项验证覆盖桌面启动校验、资源加载与确认，不包含网络下载、安装包升级、Developer ID 签名或公证。

iOS 使用固定的 Rust 1.93.1 完成新的模拟器构建，并安装到 iPhone 18 Pro（iOS 27.2）。实际界面恢复原有文档及此前快捷指令追加的段落，替换宿主前后的会话、空间、对象和回执数量一致。首次构建因官方 Rust 下载域名无法解析而失败，使用镜像安装相同版本的模拟器标准库后通过；未改变仓库工具链版本。这次没有重跑 iOS 动态包下载或系统快捷指令。

本次没有运行云端发布、修改 Pages 项目、上传商店或公开 GitHub Release。真实 iCloud 授权、跨设备冲突、真实 OAuth、商店审核和各端安装升级仍按上述待验收项执行；配置步骤与边界见[发布与更新](releases.md)。

## 云端接入

2026-11-23 起采用 iOS Cloud／TestFlight、Android Actions／Play、macOS Actions／签名公证 DMG。旧的独立 APK 分发实现已移除；此前 Android 验收记录含当时的私有 QA 包，仅代表历史验证。当前配置与接入进展见[云端发布接入](release-setup.md)。
