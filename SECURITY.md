# Security

## 报告漏洞

请勿在公开 Issue 里提交安全漏洞。改为私有渠道：

- 维护者的 GitHub Security Advisory（推荐）
- 或联系维护者邮箱（见仓库首页）

请包含：复现步骤、影响、版本。

## 安全设计要点

- 安装包内**不包含任何 API key / 凭据**；凭据由 dsh 写入运行时 `$DSH_HOME/.credentials.yaml`。
- dsh Web 只绑定 loopback（127.0.0.1），启动时校验 ready URL 必须为本地回环且无内嵌凭据。
- `sync-bundled.mjs` 只拷贝插件的**构建产物**，不把源码或凭据带进包。
- 运行时子进程以 `ELECTRON_RUN_AS_NODE` 运行；外部插件代码以用户权限运行，安装第三方 bundle 需自行判断信任（参考 dsh 官方对 `allowBuilds` 的警告）。
