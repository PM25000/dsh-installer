# PLUGINS.md — 打包你的 dsh 插件

安装包里的插件 = 一个 **bundle**（npm 包，`package.json` 声明 `dsh.bundle` + 一个 `cordis.patch.yml`）。
仓库只负责打包，不包含插件源码；插件以**构建产物**（`lib/`、`data/` 等）形式打进 `bundled/`。

## 1. 把插件放进 `bundled/`

`scripts/sync-bundled.mjs` 在每次 `pack:win` / `pack:mac` 前自动同步。每个插件的源路径按以下顺序解析：

1. 环境变量（推荐，跨平台）：
   ```sh
   COURSE_SELECTOR_SOURCE=/path/to/course-selector-assistant pnpm pack:win
   ```
2. 仓库内 `plugin-sources/<relative>` 目录（gitignored，适合本地开发）：
   ```
   plugin-sources/course-selector-assistant/        # 插件源码/构建
   plugin-sources/deepseek-harness/packages/client/ui-wallpaper/
   ```

同步只拷贝 `SOURCES` 里声明的条目（默认 `lib`、`data`、`cordis.patch.yml`、`package.json`），
不会把源码带进包。

## 2. 把插件加进 profile（`src/config.mjs`）

```js
export const managedBundles = [
  '@deepseek-ai/dsh-base',          // 必须第一个
  '@deepseek-ai/dsh-web-app',       // 提供 Web GUI
  'your-plugin-name',               // ← 你的插件
]

export const packageRoots = new Map([
  ['@deepseek-ai/dsh-base', join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-base')],
  ['your-plugin-name', join(projectRoot, 'bundled', 'your-plugin-name')],
])
```

`packageRoots` 的值是运行时装配要 **junction-link** 进 `$DSH_HOME/profiles/<name>/node_modules` 的目录，
必须能指向一个真实的包目录（`bundled/` 内或 app 的 `node_modules`）。

## 3. 插件依赖

插件的运行时依赖（`require`/`import` 的非可选依赖）必须能解析。最省事的方式是把它们加进
`package.json` 的 `dependencies`，这样 electron-builder 会打进 `node_modules`，从 `bundled/` 向上可解析。
例：`dsh-course-selector` 需要 `playwright`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`。

## 4. 验证

```sh
node src/main.mjs --assemble-only        # 装配 profile，检查 bundle 列表
node src/smoke.mjs                        # 装配/链接/幂等测试
# 真启动（开发态）：
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile desktop --port 0
# 应输出 ready 行 dsh web: http://127.0.0.1:<port>
```
