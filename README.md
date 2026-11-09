# DSH 智能优化管家 / DSH Optimizer

[English](README.en.md) · [安装](docs/install.md) · [升级与恢复](docs/upgrade.md) · [v0.3.6 发布说明](RELEASE_NOTES_v0.3.6.md) · [安全](SECURITY.md) · [隐私](PRIVACY.md)

适用于 **DeepSeek Harness (DSH)** 的非官方开源插件，用于查看本地模型用量和费用估算、预算提醒、任务检查点与异常情况；可选对**模型可见的旧对话**按最近轮数进行安全裁剪，并提供自定义任务指令编辑区。

> 本项目 **不是 DSH / DeepSeek 官方插件**。它不会保证任何固定百分比的 Token 或费用节省。插件自身的本地统计及裁剪不主动调用额外云端模型，但正常 DSH 请求仍由你配置的模型服务处理。
>
> **v0.3.6 重要修复：** v0.3.5 的上下文替换标记缺少 `data.id`，可能导致会话重启后校验失败。请勿安装已知存在此缺陷的 v0.3.5。升级 v0.3.6 **不自动修复**已经损坏的会话文件，见[故障说明](docs/session-identity-fix.md)。

| 项目 | 说明 |
|---|---|
| 插件包名 / ID | `dsh-optimizer` |
| 当前源码版本 | **0.3.6** |
| 许可证 | MIT（[LICENSE](LICENSE)，正式发布前请核实所有源码的授权） |
| 兼容性实测 | DSH Desktop `2.0.21-next`；其他 DSH 版本尚未验证 |
| 开发与测试 | Node.js ≥ 20；本地 Node 22 测试 **131/131** 通过 |
| 插件运行数据 | `<DSH_HOME>/storages/dsh-optimizer`，不属于本仓库 |

## 核心能力

- **费用与用量观察**：本地用量流水、缓存命中估算、每日/任务/Agent 预算和告警；**估算 ≠ 官方账单**。
- **上下文打包（按轮次）**：单独开关，**默认关闭**；可保留最近 **1–20** 轮已完成对话（默认 **3 轮**）。符合安全条件的旧消息通过 DSH Session surface 替换为带 UUID 的标记；原始追加式日志仍保留。
- **任务指令改写**：可在设置页编辑、保存和恢复预置任务指令；内容保存在本机配置中，并由 DSH `systemPrompt.section()` 供后续模型请求使用。该功能是行为指导，**不是文件系统权限限制**。
- **工具结果、检查点和异常**：在 `enforce` 模式下可根据配置精简工具输出；默认 `audit` 模式只观察不改写相关输出；检查点和异常监测按现有配置执行。
- **本地仪表盘**：配置、诊断报告和用量摘要。

旧的“禁止 DSH 主动回顾历史会话和扫描工作区”权限审批功能已在 v0.3.5 移除，**本插件不控制 DSH 的文件访问权限**。

## 安装与验收

先备份现有 DSH 插件和状态目录，再使用 DSH 插件管理器安装此仓库根目录（有 `package.json` 和 `cordis.patch.yml`）；也可使用 DSH CLI：

```bash
# 在本仓库根目录内，profile 名以实际环境为准
dsh plugin --profile desktop add .
```

确认来源与版本后批准安装、按需重启 DSH，然后在「设置 → 智能优化管家」查看版本 `v0.3.6`。新版开关**不会替你自动开启**。请先在测试会话里检查工具消息、历史裁剪和重启恢复；详情见 [安装手册](docs/install.md)。

### 从 v0.3.5 升级

升级前先**关闭上下文打包**，备份 `config.json`、整个会话目录和插件源码。升级到 v0.3.6 后，先确认正常会话，再由用户自行开启打包测试。**仅升级源码不能修复已落盘的匿名替换事件**；已报 `lacks an identified message` 的会话需要单独诊断恢复。不要在运行中的 DSH 内直接编辑 `.jsonl.zstd`。见 [升级说明](docs/upgrade.md)。

## 开发与测试

```bash
npm test
npm run check
npm run release:audit
npm pack --dry-run
```

测试不需要额外 npm 依赖；真实的 DSH 会话回放、兼容性和计费改善必须在目标宿主中另行验收。发布前请执行 [检查清单](docs/release-checklist.md)。

## 重要限制

1. 历史轮数限制只作用于**可安全裁剪的模型可见历史**；系统/开发者有效指令、未配对工具链、模型工具定义及宿主运行时上下文可能继续占用输入。没有整个请求的 Token 硬上限。
2. 裁剪不会删除原始聊天日志，也不能保证价格按裁剪字符数同比下降；提示词缓存命中率可能变化。
3. 插件会访问本地任务、工具结果和会话元数据，可能把原始工具结果写到插件状态目录。**不要公开状态目录、真实会话、诊断原件或绝对个人路径**。
4. 本地仪表盘及接口不构成强身份认证边界，**不要向公网暴露 DSH 的本地 Web 端口**。
5. 公开版将预置任务指令编号规范为连续 `1–5`（与实机验收时的手动编号修正一致），不改变指令语义；个人在后台保存的自定义指令仍以 `config.json` 为准，未随开源包公开。

## 文档

[安装](docs/install.md) · [GitHub 发布](docs/github-publish.md) · [配置](docs/configuration.md) · [上下文打包](docs/context-packing.md) · [任务指令](docs/task-instructions.md) · [升级/回滚](docs/upgrade.md) · [FAQ](docs/faq.md) · [发布记录](CHANGELOG.md) · [修复说明](docs/session-identity-fix.md) · [实机验收摘要](docs/field-validation.md) · [贡献指南](CONTRIBUTING.md) · [市场索引](market/README.md)

发布前请确认所有源文件的版权与再许可权限。贡献和问题报告请先脱敏。
