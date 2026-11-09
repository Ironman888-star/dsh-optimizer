# 配置与状态目录 / Configuration

插件在 `<DSH_HOME>/storages/dsh-optimizer/config.json` 中保留本地配置，默认值定义于 `lib/config.js`。`<DSH_HOME>` 由 DSH 宿主解析；源码文件夹与用户数据目录分离。**不要公开 `config.json`**，其中可能有主人自定义任务指令、路径和业务设置。

| 主要键 | 缺省值 | 说明 |
|---|---|---|
| `enabled` | `true` | 插件主功能启用状态 |
| `mode` | `audit` | `audit` 主要观察；`enforce` 才执行允许的输出整形 |
| `contextPacking.enabled` | `false` | 独立的会话历史打包开关 |
| `contextPacking.maxHistoryTurns` | `3` | 1–20，按最近完成的对话轮数 |
| `taskInstructions.text` | 5 条预置建议 | 编辑内容通过系统提示词注入；长度不超过 12,000 字符 |
| `budgets.dailyUSD` | `5` | 每日费用估算告警参考值，非账单 |
| `budgets.projectUSD` | `50` | 项目费用估算参考值 |
| `checkpoint.enabled` | `true` | 检查点功能开关 |
| `toolResult.enabled` | `true` | 配合运行模式控制工具输出处理 |
| `server.enabled` | `true` | 本地服务状态；**不应暴露公网** |

**注意：** 这里的 `context.defaultBudgetTokens`、`context.hardBudgetTokens` 是上下文压力监测预算，不是 `contextPacking` 的历史 Token 裁剪上限。v0.3.6 的打包逻辑**只按轮数**。

尽量使用 DSH 设置页面修改。若必须手动编辑，先退出 DSH、备份 `config.json`、保持 JSON 正确并在启动后确认值已持久化。升级时不要直接把别人的 `config.json` 拷到本机。
