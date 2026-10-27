# 常见问题

[English](faq.md) | **简体中文**

关于 OpenCode 2 社区插件 **opencode-token-usage** 的简明解答。完整指南见 [README](../README.zh-CN.md)。

## 如何在 OpenCode 中查看 token 用量？

运行 `opencode plugin add @chenlongapps/opencode-token-usage` 安装插件，然后重启 OpenCode 2。通过侧边栏的 **Token Usage** 面板或输入 `/usage`，查看已上报的输入、输出、推理和缓存 token。会话用量包含其后代子代理，不按文本长度推算。插件需要 Node.js 22+，OpenTUI 引擎限制见 [README 的兼容性说明](../README.zh-CN.md#兼容性)。安装与快速上手见 [README](../README.zh-CN.md#安装)。

## 如何在 OpenCode 中查看估算 API 费用？

安装 **opencode-token-usage** 后，可查看侧边栏的 **Est. Cost**，或打开 `/usage` 中的 **By Model** 区域。插件按每条已记录的 assistant 与 compaction 调用实际使用的模型估算费用，使用 OpenCode 解析的价格，并以内置原厂价格快照作为回退。价格缺失时显示 `—`；存在无法计价的调用时，已知小计标注 `partial`。估算不含网关加价、工具费和税费等，不等于提供商账单。详见 [README 的计价行为说明](../README.zh-CN.md#行为)。

## 如何在 OpenCode 中监控 TPS 和 TTFT？

有可测数据时，**Token Usage** 面板会显示每秒 token 数（**TPS**）和平均首 token 时间（**TTFT**）。不带 `~` 的 TPS 使用会话树中有效 assistant 样本已上报的输出与推理 token，以及对应的计时数据。流式进行中，近期可观察内容交付的数据充足时，优先显示带 `~` 的实时估算；否则回退到历史 TPS，没有可用历史值则隐藏该行。实时与历史 TPS 的计时口径不同。详见 [README 的指标与限制](../README.zh-CN.md#指标)。

## 如何统计子代理的 token 用量？

**opencode-token-usage** 会自动将后代子代理计入当前查看会话的 token 和估算费用汇总，即使这些子代理从未被打开。进入子代理视图后，点击输入区上方的摘要，可在完整面板中查看该子代理自身子树的统计。分叉继承历史不会再次计为新用量。上下文占用和 Run Time 仅针对当前查看会话，不叠加子会话的对应数值。详见 [README 的详细用量指南](../README.zh-CN.md#详细用量)。

## OpenCode 能显示隐藏推理 token 的速度吗？

本插件无法还原提供商未暴露的隐藏推理实时速度。实时 TPS 估算的是可观察文本、推理摘要和工具输入的交付速度，而非模型内部生成速度；摘要和缓冲突发无法反映完整的隐藏推理。历史 TPS 可以将提供商上报的推理 token 总量与输出 token 一并计算，但这是综合平均值，不是单独的隐藏推理速度。详见 [README 的性能限制](../README.zh-CN.md#行为)。

## 插件会向外部服务器发送提示词吗？

不会。插件不向模型提供商或第三方分析服务发送提示词，打开 `/usage` 也不会发起模型请求。它从你配置的 OpenCode 服务器读取会话数据，该服务器可以在本地，也可以在远程。服务端的上下文钩子检查已组装的请求以估算提示词构成，仅保存各类别的汇总估算值及时间戳／模型元数据，不保存提示词正文。OpenCode 本身仍会向你配置的提供商发送正常模型请求。插件运行时不会下载价格。详见 [README 的上下文构成说明](../README.zh-CN.md#详细用量)与[运行行为](../README.zh-CN.md#行为)。

## 为什么安装后没有看到 Token Usage 面板？

安装插件后先重启 OpenCode，再打开会话。侧边栏面板需要终端足够宽，且 `session.sidebar` 设为 `auto`；也可输入 `/usage`，不依赖侧边栏直接打开详情。OpenCode 在子代理视图中隐藏侧边栏，插件会改为在输入区上方显示可点击的摘要。连接远程服务器时，需按 [README 的其他安装方式](../README.zh-CN.md#其他安装方式)配置本机终端入口。基本操作见[快速上手](../README.zh-CN.md#快速上手)。

## 插件支持 OpenCode 1 吗？

不支持。**opencode-token-usage** 面向 OpenCode 2，使用其插件及终端界面 API，并非 OpenCode 1 插件。已测试的 OpenCode 2 宿主版本及各功能的验证说明见 [README 的兼容性章节](../README.zh-CN.md#兼容性)。未列出的版本不能仅因属于 OpenCode 2，就被视为已经通过验证。

## 为什么 Context、Last Request 和 Session 的 token 数量不同？

它们回答的问题不同。**Context Window** 使用当前查看会话最后一次已完成压缩之后、最近一条 assistant 上报的用量，并以活动模型的上下文上限为参照。**Last Request** 展示该会话中选出的最近一次已上报调用，上下文上限未知时仍可显示。**Session** 累计整棵会话树的用量，包含子代理。Context 不是历史累计值，**Context Breakdown** 则是独立的提示词构成估算，不是可以与其他数值相加的实测 token。详见 [README 的弹窗区域说明](../README.zh-CN.md#详细用量)。

## 缓存 token 是否计入 Total？缓存命中率如何计算？

计入。**Total** 为 Input、Output、Reasoning、Cache Read 和 Cache Write 五类之和。**Input** 不含两类缓存 token，**Output** 不含 Reasoning，因此不会重复相加。**Cache Rate** 为 `Cache Read ÷ (Input + Cache Read + Cache Write)`，分母是全部传入 token，而非仅未缓存输入，也不是包含输出的全部 token。详见 [README 的指标定义](../README.zh-CN.md#指标)。

## 为什么估算费用显示 —、partial 或 $0.00？

`—` 表示插件无法为已记录用量计价；`partial` 表示部分调用无法计价，当前显示的是已知小计。`$0.00` 表示所用费率产生了确认零值的估算，不代表缺少价格数据。低于 `$0.001` 的正费用显示为 `<$0.001`，不会被四舍五入成免费。这些标记都不保证与提供商账单一致。详见 [README 的计价及显示规则](../README.zh-CN.md#行为)。

## 价格会自动更新吗？插件运行时会联网查询价格吗？

仓库的价格工作流每 4 小时检查 models.dev，经审核的价格发生变化且验证通过后，会发布更新后的回退价格快照。快照随插件版本分发；已安装插件在运行或刷新统计时，不会从 models.dev 下载价格。更新插件可获得较新的内置快照。计价策略仍会使用 OpenCode 解析的价格，因此快照不是唯一可能的费率来源。详见 [README 的价格更新工作流](../README.zh-CN.md#开发)与[计价行为](../README.zh-CN.md#行为)。

## 为什么 Run Time 与各条回答页脚耗时之和不同？

**Run Time** 只累计当前查看会话每轮最终已完成回答的耗时，不重复相加各条 assistant step 的重叠时长，也不额外叠加子会话耗时。它先累加未取整的毫秒值再格式化，因此可能与相加已取整的页脚标签不同。运行中的 `~` 表示仅用于显示的当前已耗时估算，不是最终耗时预测；上报的完成耗时会替换估算，允许显示值小幅下降。详见 [README 的耗时行为说明](../README.zh-CN.md#行为)。

## 重启 OpenCode 后，用量和 Run Time 还会保留吗？

插件会从会话保留的消息历史中重新统计 token、估算费用及原生已完成轮次耗时，也适用于安装插件之前创建的会话，不要求调用发生时插件一直运行。能否恢复取决于 OpenCode 仍保留的数据：缺失的 token 或计时信息无法重建，已删除历史也不会由插件恢复。实时估算并不是另一套永久用量账本。详见 [README 的历史与读取失败行为](../README.zh-CN.md#行为)。

## 分叉、压缩和回退会如何影响统计？

分叉是独立的会话树：继承消息副本不会再次计为新 token 用量，也不计入分叉自身的 Run Time。已完成压缩会改变上下文和最近请求的选择边界，但保留的旧用量与已完成轮次耗时仍进入累计；压缩调用本身上报的 token 和估算费用也会计入。已提交回退删除消息后，这些消息的贡献会被移除；仅暂存回退不会从 Run Time 中移除已完成轮次。详见 [README 的统计行为](../README.zh-CN.md#行为)与[请求选择规则](../README.zh-CN.md#详细用量)。

## 为什么 Context Breakdown 显示来源估算不可用？

**Context Breakdown** 需要服务端插件捕获已组装的模型请求，并通过可用的插件 RPC 读取估算。会话尚未捕获请求，或当前连接无法使用该 RPC 时，无法展示来源构成。打开 `/usage` 不会为了填充该区域而发起模型请求。这与已上报 token 用量互相独立：来源估算缺失不等于零用量，也不妨碍 **Last Request** 展示已上报 token。详见 [README 的上下文构成要求](../README.zh-CN.md#详细用量)。
