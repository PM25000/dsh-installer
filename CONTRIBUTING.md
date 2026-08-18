# Contributing

感谢你愿意为 dsh-installer 贡献。

## 开发流程

1. Fork 并 clone 本仓库。
2. `pnpm install`。
3. 做改动，并保证离线测试通过：
   ```sh
   node src/smoke.mjs
   node src/launch-smoke.mjs
   node --test scripts/
   ```
4. 涉及打包链路（electron-builder / afterPack / NSIS）的改动，跑一次 `pnpm pack:win` 验证产物。
5. 提交 PR，说明改动动机与验证方式。

## 约定

- 不改动打包范围之外的官方 DSH 源码；插件一律以构建产物进 `bundled/`。
- 新增插件时同步更新 `scripts/sync-bundled.mjs` 的 `SOURCES` 与 `src/config.mjs`。
- 注释用英文，面向用户文案保持中文（与插件一致）。
- 不要提交 `dist/`、`node_modules/`、`bundled/`、`plugin-sources/`（已 gitignore）。

## 提交信息

简短、动词开头，如 `feat: add mac target` / `fix: disable native directory picker`。
