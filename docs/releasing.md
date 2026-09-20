# npm 发布

包名为 [`@chenlongapps/opencode-token-usage`](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)，首次发布版本为 `0.2.1`。无作用域名称 `opencode-token-usage` 已由其他作者注册，不要修改为该名称。

## Trusted Publishing

若尚未配置，在 npm 包设置的 Trusted Publisher 中添加 GitHub Actions：

- Organization or user：`chenlongapps`
- Repository：`opencode-token-usage`
- Workflow filename：`publish.yml`
- Allowed action：允许 `npm publish`

## 后续版本

### 1. 提交现有改动

`npm version` 会创建版本提交和 Git 标签，因此要求工作区干净。先检查、验证并提交当前改动：

```bash
git status
npm run typecheck
npm test
npm run build
git add .
git diff --cached
git commit -m "chore: prepare next release"
```

如果没有待提交改动，可跳过 `git add` 和 `git commit`。不要使用 `--force` 绕过工作区检查。

### 2. 升级版本

发布补丁版本时运行：

```bash
npm run release:patch
```

该脚本执行 `npm version patch`，会同步更新 `package.json` 和 `package-lock.json`，创建版本提交，并在本地创建 `vX.Y.Z` 标签。发布 minor 或 major 版本时改用：

```bash
npm version minor
npm version major
```

### 3. 推送提交和标签

`npm version` **不会自动推送标签到 GitHub**。使用 `--follow-tags` 同时推送版本提交和标签：

```bash
git push origin main --follow-tags
```

也可以分开推送：

```bash
git push origin main
git push origin vX.Y.Z
```

### 4. 创建 GitHub Release

仅推送标签不会触发发布工作流，还需要创建同名 GitHub Release：

```bash
gh release create vX.Y.Z --generate-notes --title vX.Y.Z
```

也可以在 GitHub Releases 页面选择已有标签并发布 Release。`.github/workflows/publish.yml` 会校验 Release 标签与 `package.json` 版本，运行类型检查和测试，再通过 npm Trusted Publishing 的 OIDC 身份发布；不需要保存长期 `NPM_TOKEN`。npm 会为公开仓库与公开包自动生成 provenance。

### 5. 确认发布

```bash
gh run list --workflow publish.yml --limit 1
npm view @chenlongapps/opencode-token-usage version dist-tags --json
```

npm 接受发布后可能需要几分钟才能完成处理和更新 `latest`。确认新版本和 `latest` 均已出现在 registry 后，发布才算完成。

## 常见问题

- `Git working directory not clean`：仍有已暂存或未暂存的改动，先提交后再执行版本升级。
- GitHub 没有新标签：本地标签尚未推送，执行 `git push origin main --follow-tags` 或单独推送对应标签。
- 标签存在但没有发布到 npm：确认已经创建 GitHub **Release**，并检查 `publish.yml` 的运行结果。
- npm 暂时返回旧版本或 404：发布可能仍在处理，等待几分钟后使用 `npm view` 重新查询。

若 Release 标签与 `package.json` 版本不一致，工作流会在发布前失败。
