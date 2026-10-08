# npm 发布

包名为 [`@chenlongapps/opencode-token-usage`](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)，首次发布版本为 `0.2.1`。无作用域名称 `opencode-token-usage` 已由其他作者注册，不要修改为该名称。

## Trusted Publishing

若尚未配置，在 npm 包设置的 Trusted Publisher 中添加 GitHub Actions：

- Organization or user：`chenlongapps`
- Repository：`opencode-token-usage`
- Workflow filename：`publish.yml`
- Allowed action：允许 `npm publish`

GitHub Actions 的发布任务需要 `id-token: write`，并使用 GitHub 托管 runner、Node.js 24 和 npm >= 11.5.1；现有 `publish.yml` 已包含这些配置。无需新增长期 `NPM_TOKEN`。若配置了 npm 的 Environment name，还需让工作流使用同名 GitHub environment。

## 自动价格 patch

`.github/workflows/update-prices.yml` 每天 UTC 22:00 检查 models.dev，也可在 Actions 中选择 `main` 手动运行：

```text
更新白名单内的原厂快照（无变化就结束）
→ 类型检查、测试、构建、打包检查
→ patch 升级（如 0.4.4 → 0.4.5）
→ 只提交快照与两个 package 文件
→ 原子推送 main 和 vX.Y.Z
→ 创建 GitHub Release
→ 显式 dispatch 标签上的 publish.yml
→ npm OIDC 发布并核验 registry
```

不创建待审 PR，也不等待人工合并。前提是仓库允许工作流的 `contents: write`、`actions: write`，且 `main`／标签规则允许 Actions 机器人推送；若强制 PR 审核或禁止机器人推送，应先调整发布策略，脚本不会绕过保护规则。新厂商、新系列、别名及人工价格例外仍须单独审核。

使用 `GITHUB_TOKEN` 创建的 Release 不会触发另一个 `release` 工作流，因此更新任务会显式发送 `workflow_dispatch`。发布是独立的 `publish.yml` 运行，检出固定版本标签，继续匹配现有 npm Trusted Publisher，并将 provenance 关联到实际发布的提交。价格更新工作流成功只表示已请求发布；最终以 `publish.yml` 的结果为准。

### 失败与重试

- 检查失败：不升级版本、不提交、不打标签、不发布。
- 远端 `main` 在验证期间改变：原子推送整体失败，不强推或自动重放旧结果；重新运行更新任务。
- 标签／npm 版本已被占用、registry 故障或新版本不高于 npm `latest`：停止，不猜测版本或倒退 `latest`。
- 自动价格标签已推送，但创建 Release、dispatch 或 npm 发布失败：下一次更新任务先重试该标签，不再升 patch。未发布的手动版本不会被每日任务擅自发布，需先完成手动发布。
- npm 已收到版本：重跑发布任务会跳过 `npm publish`，不修改已有版本或其 dist-tag。
- `npm publish` 成功但可见性校验超时：不另升版本或移动标签。先查询目标版本与 `latest`；版本已出现时重跑原标签，版本尚未出现时等待 npm 处理。持续的 registry 查询故障也会使校验失败，不会被当作版本不存在或成功发布。

也可直接重试指定标签（不要选择 `main`）：

```bash
gh workflow run publish.yml --ref vX.Y.Z
```

## 手动发布其他版本

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

仅推送标签不会触发发布工作流。手动创建同名 GitHub Release 可触发发布：

```bash
gh release create vX.Y.Z --generate-notes --title vX.Y.Z
```

也可以在 GitHub Releases 页面选择已有标签并发布 Release，或显式运行 `gh workflow run publish.yml --ref vX.Y.Z`。`.github/workflows/publish.yml` 要求当前 ref 确实为匹配 `package.json` 和锁文件版本的标签，运行类型检查和测试，再通过 npm Trusted Publishing 的 OIDC 身份发布；不需要保存长期 `NPM_TOKEN`。npm 会为公开仓库与公开包自动生成 provenance。所有发布任务串行执行，已存在的 npm 版本会跳过发布，新发布后会核验版本与 `latest`。

### 5. 确认发布

```bash
gh run list --workflow publish.yml --limit 1
npm view @chenlongapps/opencode-token-usage version dist-tags --json
```

npm 接受发布后可能需要几分钟才能完成处理和更新 `latest`。确认新版本和 `latest` 均已出现在 registry 后，发布才算完成。

可见性校验默认每 10 秒轮询，网络请求和等待共用 **10 分钟总时限**；单次请求最多 30 秒，也不能超出剩余预算。日志区分目标版本尚未可见、版本可见但 `latest` 仍旧、HTTP／网络错误，并显示尝试次数和已用时间。超时仍返回非零退出码，在日志与 Actions 摘要中保留最后原因和原标签重试提示，但不会将“未完成校验”断言为“npm 发布失败”。

`scripts/release.mjs verify-published` 的时间配置可通过环境变量调整，单位为毫秒，必须为 `1` 至 `2147483647` 的整数：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `NPM_VERIFY_TIMEOUT_MS` | `600000` | registry 校验总时限 |
| `NPM_VERIFY_INTERVAL_MS` | `10000` | 两次失败轮询之间的等待时间，最后一次按剩余预算缩短 |

`publish.yml` 显式使用上述默认值，校验步骤上限为 11 分钟，整个发布任务上限仍为 20 分钟；调大校验时限时须同步检查这两个 Actions 上限。新发布要求目标版本及 `latest` 均匹配；重跑已发布版本仅核验该版本，不要求较新的 `latest` 倒退。

工作流与脚本固定在版本标签的提交上。修复提交合并到 `main` 后仅供后续新标签使用；重跑旧标签仍使用旧实现，但已可见的版本会直接跳过发布并通过核验。不要为了更新发布脚本移动已发布标签。

## 常见问题

- `Git working directory not clean`：仍有已暂存或未暂存的改动，先提交后再执行版本升级。
- GitHub 没有新标签：本地标签尚未推送，执行 `git push origin main --follow-tags` 或单独推送对应标签。
- 标签存在但没有发布到 npm：确认手动 Release 已触发发布，或执行 `gh workflow run publish.yml --ref vX.Y.Z`，并检查 `publish.yml` 的运行结果；自动价格 Release 通过独立 dispatch 触发。
- npm 暂时返回旧版本或 404：发布可能仍在处理，等待几分钟后使用 `npm view` 重新查询。
- Actions 显示失败但 `npm publish` 已输出成功：检查失败步骤是否为 registry 可见性校验。可分别查询 `npm view @chenlongapps/opencode-token-usage@X.Y.Z version` 和 `npm view @chenlongapps/opencode-token-usage dist-tags --json`，确认后重跑原标签，不要为消除这个超时另发一个版本。

若 Release 标签与 `package.json` 版本不一致，工作流会在发布前失败。
