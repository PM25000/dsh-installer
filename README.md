# dsh-installer

一键安装包：把 **DeepSeek Harness (dsh) 运行时 + 你选定的 dsh 插件** 打包成可安装的应用。
Windows 出 NSIS 安装包（.exe），macOS 出 DMG/ZIP。

设计要点：

- **打包的是 dsh 运行时本体，不是源码**：依赖 npm 发布的 `@deepseek-ai/dsh` 及其运行时包（已编译 `lib/`），
  `ELECTRON_RUN_AS_NODE` 让打包后的 Electron 二进制自己充当 Node 去跑 dsh CLI。
- **插件离线装配**：选定插件打进 `bundled/`（构建产物），首启时运行时把它 junction-link 进
  `$DSH_HOME/profiles/<name>` 的 `node_modules`，零网络、零编译。
- **数据目录隔离**：安装版默认 `DSH_HOME` 指向 `%LOCALAPPDATA%\dsh-installer\data`
  （macOS：`~/Library/Application Support/dsh-installer/data`），不污染已有 `~/.dsh`。
- **动态端口**：dsh Web 以 `--port 0` 启动，主进程解析 ready 行 + 健康探测后再打开窗口。

参考实现：[deepseek-harness-desktop](https://github.com/deepseek-ai/deepseek-harness/blob/master/third-party/deepseek-harness-desktop)。

## 目录结构

```
src/
  electron-main.mjs        Electron 主进程：装配 profile → 启动运行时 → BrowserWindow
  runtime-controller.mjs   exe-as-node 启动、ready 行解析、loopback 校验、健康探测、停止
  assemble-profile.mjs     运行时装配：生成 profile + junction-link bundled 插件
  config.mjs               你的配置：插件清单（managedBundles/packageRoots）、dsh CLI 路径
  main.mjs                 纯 node 调试入口（--assemble-only / 启动）
  smoke.mjs, launch-smoke.mjs  离线冒烟测试
scripts/
  sync-bundled.mjs         打包前从插件源码同步最新构建到 bundled/
  after-pack.cjs           electron-builder afterPack：运行时瘦身 + 恢复必需 peer
  verify-package.mjs       校验产物并生成 SHA256SUMS
  after-pack.test.mjs      离线测试
build/
  installer.nsh            NSIS 装前清理旧进程
  cleanup-stale-processes.ps1
bundled/                   (gitignored) 打包进 exe 的插件构建产物，由 sync 生成
.github/workflows/         release.yml：tag 触发 Win + macOS 构建发布
```

## 前置条件

- Node.js ≥ 22.19，pnpm ≥ 10
- 构建 Windows 包：Windows；构建 macOS 包：macOS（electron-builder 限制）
- 插件源：你自己的插件源码构建（见 [PLUGINS.md](PLUGINS.md)）

## 快速开始

```sh
pnpm install                          # 安装 electron / electron-builder / dsh 运行时本体
pnpm pack:win                         # 自动同步插件 → 打包 → dist/dsh-installer-Setup-*.exe
node scripts/verify-package.mjs       # 校验 + 生成 SHA256SUMS.txt
node --test scripts/                  # 离线脚本测试
```

macOS：

```sh
COURSE_SELECTOR_SOURCE=/path/to/course-selector-assistant \
WALLPAPER_SOURCE=/path/to/deepseek-harness/packages/client/ui-wallpaper \
pnpm pack:mac
```

插件源也可放在仓库内 gitignored 的 `plugin-sources/` 目录下（见 [PLUGINS.md](PLUGINS.md)）。

## 配置你的插件

编辑 `src/config.mjs`：

- `managedBundles`：profile 的 bundle 层顺序（base 优先，其后是你的插件）。
- `packageRoots`：每个插件包名 → 包目录（运行时装配要 link 的目标）。
- `cliPath`：dsh 运行时 CLI（`node_modules/@deepseek-ai/dsh/lib/bin.js`）。

打包前 `sync-bundled.mjs` 会把插件源码的最新 `lib/`/`data` 同步进 `bundled/`，
所以每次改完插件直接 `pnpm pack:win` 即可。

## 测试

```sh
node src/smoke.mjs            # 装配 / junction link / 幂等 / ready 行解析（离线）
node src/launch-smoke.mjs     # 启动链路：spawn → ready → 健康探测 → 停止（离线）
node --test scripts/          # afterPack 瘦身逻辑
```

## 发布（GitHub Release）

推送 `v*` tag 触发 `.github/workflows/release.yml`：
- `windows-latest`：`pack:win` → exe + blockmap + latest.yml + SHA256SUMS
- `macos-latest`：`pack:mac` → dmg/zip + SHA256SUMS-mac.txt

发布前把 `electron-builder.yml` 的 `publish.owner/repo` 改成你的仓库。

## 已知限制

- 原生 Win32 目录对话框在打包环境下不可用，安装版默认用浏览器内置的 browse 变体
  （`directory-picker` 禁用 + `-browse` 行）。
- Playwright 浏览器二进制不随包分发，按需 `npx playwright install chromium`。
- macOS 构建只能在 macOS 上执行。
- 应用图标暂用 Electron 默认（`electron-builder.yml` 有 TODO）。

## License

BSD-3-Clause，见 [LICENSE](LICENSE)。
