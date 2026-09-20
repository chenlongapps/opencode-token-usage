# npm 发布

包名为 [`@chenlongapps/opencode-token-usage`](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)，首次发布版本为 `0.2.1`。无作用域名称 `opencode-token-usage` 已由其他作者注册，不要修改为该名称。

## Trusted Publishing

若尚未配置，在 npm 包设置的 Trusted Publisher 中添加 GitHub Actions：

- Organization or user：`chenlongapps`
- Repository：`opencode-token-usage`
- Workflow filename：`publish.yml`
- Allowed action：允许 `npm publish`

创建 `v0.2.1` GitHub Release 时，发布工作流会发现该版本已经存在并跳过重复发布。

## 后续版本

1. 用 `npm version patch`、`npm version minor` 或 `npm version major` 同步更新 `package.json`、锁文件并创建 `vX.Y.Z` 标签。
2. 推送提交和标签，在 GitHub 创建同名 `vX.Y.Z` Release。
3. `.github/workflows/publish.yml` 会校验 Release 标签、执行检查，并通过 npm Trusted Publishing 的 OIDC 身份发布；不需要保存长期 `NPM_TOKEN`。npm 会为公开仓库与公开包自动生成 provenance。

若 Release 标签与 `package.json` 版本不一致，工作流会在发布前失败。
