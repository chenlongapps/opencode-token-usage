# 仓库指南

## 当前状态

- 本仓库是 Node.js 22+、npm、TypeScript ESM 工程，当前包版本为 0.3.0，使用 `@opencode/plugin@2.0.11`。
- `src/usage.ts` 负责统计、上下文、定价与格式化；`src/source.ts` 负责 v2 API、分页与去重；`src/controller.ts` 负责刷新生命周期；`src/tui.tsx` 负责侧边栏。
- 可执行检查：`npm run typecheck`、`npm test`、`npm run build`。`npm run test:smoke` 使用打包产物和隔离的 OpenCode 2.0.11、Python 3 终端、本地模拟提供商进行集成验证。
- `ROADMAP.md` 区分已验证功能与后续规划；只勾选实际通过验证的项目。没有 lint 配置，不要臆造 lint 命令。
- 2026-09-23 已通过类型检查、43 项自动化测试、构建及 SDK 2.0.11 + 真实 OpenCode 2.0.11 打包集成验证，记录见 `docs/verification.md`。

## 产品约定

- 目标是为 OpenCode 2 开发一个 Node.js 插件。不要复制 OpenCode 1 的 API；在实现插件和 TUI 集成之前，请根据 OpenCode 2 文档进行验证。
- 使用量应在整个会话树中累计，包括子代理。
- `Input` 不包括缓存读取和缓存写入；传入 token 总数为 input + cache read + cache write。
- `Output` 不包括 `Reasoning`；`Total` 为五类 token 之和。缓存命中率分母为全部传入 token。
- 成本按会话树中每条 assistant 与 compaction 消息实际记录的模型及五类 token 分别估算。优先使用当前会话位置经 OpenCode 解析的完整适用价格；适用档位或本次实际使用的 token 类别缺价时，整条消息回退到插件内置的厂商官方价格快照，不混用两套费率。网关模型仅通过精确厂商 ID、明确别名和已知包装格式匹配，不按相似名称猜测。无法定价时显示不可用；只有部分消息可定价时明确标注 `partial`；明确零价显示 `$0.00`。内置价格采用标准同步 API 公开价，不含网关加价、区域价、折扣和工具费，Cost 仍是估算，不代表提供商账单。
- 读取失败不得显示为零用量；刷新失败保留上次完整快照，切换会话时丢弃旧请求结果。
- 分叉不是 `parentID` 子代理关系。2.0.9 为继承消息生成带 `_序号` 后缀的 ID；这些副本的用量只归原始来源。升级 OpenCode 时必须重新核对这一实现约定。
- 上下文用量取当前查看会话中最后一条带 `tokens` 的 assistant 消息（只搜索最后一次 `status === "completed"` 的 compaction 之后）的五类 token 之和；分母为当前查看会话活动模型的 `limit.context`，缺失、为零或非有限值时隐藏该行。它只反映被查看会话本身，不随子树累计；分叉继承副本仍计入被查看会话的上下文。宿主实现参照 OpenCode 2.0.10 侧边栏的 `Ws`/`S6`，SDK 锁定 2.0.11；升级 OpenCode 或 SDK 时必须重新核对 compaction 的 `status` 与消息排序语义。
- 上下文行是面板第一行（状态提示之后），行内为 `已用 / 上限 (百分比%)`，百分比保留一位小数、允许超过 100%。
- 进度条、紧凑模式、`/usage` 和公开价格目录不在当前版本范围内。
- 2.0.9–2.0.11 在子代理视图中不挂载侧边栏；通过 `session.composer.top` 显示相同完整面板，保持子代理中的全树统计可见。

## 官方文档

- [OpenCode 2 文档](https://opencode.ai/v2/docs)
- [OpenCode 2 插件开发文档](https://opencode.ai/v2/docs/build/plugins)
