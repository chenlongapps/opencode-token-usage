# 仓库指南

## 当前状态

- 本仓库已建立 v0.1.0 的 Node.js 22+、npm、TypeScript ESM 工程，使用 `@opencode/plugin@2.0.9`。
- `src/usage.ts` 负责统计、定价与格式化；`src/source.ts` 负责 v2 API、分页与去重；`src/controller.ts` 负责刷新生命周期；`src/tui.tsx` 负责侧边栏。
- 可执行检查：`npm run typecheck`、`npm test`、`npm run build`。`npm run test:smoke` 使用打包产物和隔离的 OpenCode 2.0.9、Python 3 终端、本地模拟提供商进行集成验证。
- `ROADMAP.md` 区分已验证功能与后续规划；只勾选实际通过验证的项目。没有 lint 配置，不要臆造 lint 命令。
- 2026-09-19 已通过类型检查、17 项自动化测试、构建及真实 OpenCode 2.0.9 打包集成验证，记录见 `docs/verification.md`。

## 产品约定

- 目标是为 OpenCode 2 开发一个 Node.js 插件。不要复制 OpenCode 1 的 API；在实现插件和 TUI 集成之前，请根据 OpenCode 2 文档进行验证。
- 使用量应在整个会话树中累计，包括子代理。
- `Input` 不包括缓存读取和缓存写入；传入 token 总数为 input + cache read + cache write。
- `Output` 不包括 `Reasoning`；`Total` 为五类 token 之和。缓存命中率分母为全部传入 token。
- 成本使用当前查看会话的活动模型，为每条消息选择价格阶梯后合计；未选定模型时使用该会话位置的默认模型。缺失适用价格按官方计费实现回退为 0，并明确标注默认价格与估算性质。
- 读取失败不得显示为零用量；刷新失败保留上次完整快照，切换会话时丢弃旧请求结果。
- 分叉不是 `parentID` 子代理关系。2.0.9 为继承消息生成带 `_序号` 后缀的 ID；这些副本的用量只归原始来源。升级 OpenCode 时必须重新核对这一实现约定。
- Context、进度条、紧凑模式、`/usage` 和公开价格目录不在首版范围内。
- 2.0.9 在子代理视图中不挂载侧边栏；通过 `session.composer.top` 显示相同完整面板，保持子代理中的全树统计可见。

## 官方文档

- [OpenCode 2 文档](https://opencode.ai/v2/docs)
- [OpenCode 2 插件开发文档](https://opencode.ai/v2/docs/build/plugins)
