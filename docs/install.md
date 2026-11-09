# 安装与首次验收 / Install and first-run verification

该插件为非官方 DeepSeek Harness (DSH) Bundle，安装和更新可能影响当前 profile 的所有会话。先完整备份。

## 兼容性与准备

- 已有 DSH Desktop。已报告的实机宿主为 `2.0.21-next`；其他宿主版本请先在隔离 profile 测试。
- 本仓库目录内有 `package.json`、`cordis.patch.yml`、`index.js`、`client.js` 和 `lib/`。
- Node.js 20+ 可供本地测试；实际加载依赖目标 DSH 宿主。
- 备份目前的插件目录、`<DSH_HOME>/storages/dsh-optimizer/` 和重要会话目录。`<DSH_HOME>` 常由 DSH 配置或用户目录决定；不要假定公开示例路径与你一致。

## 安装渠道

**方式 A：DSH 的插件管理界面。** 选择添加本地插件/Bundle，指定此仓库根目录（含 `package.json`），核对 `dsh-optimizer` 与来源/版本后确认。若管理器可识别 Git 安装源，也可在正式公开仓库创建后使用其受支持的 Git URL。

**方式 B：DSH CLI（已安装时）。**

```bash
# 在本仓库根目录运行；profile desktop 仅为示例
dsh plugin --profile desktop add .
```

不要手工编辑 profile 的 `package.json`、`pnpm-lock.yaml`、`node_modules` 或 Junction。DSH 插件管理器会维护 profile 的依赖与加载顺序。

## 首次使用检查

1. 重启/刷新 DSH（按插件管理器提示），打开「设置 → 智能优化管家」，版本显示 **v0.3.6**，日志可见 `boot v0.3.6`。
2. 默认上下文打包为 **关闭**，保留轮数默认 **3**；可设置 1–20，开关点击即保存。升级安装时会保留本机已有配置。
3. 任务指令编辑区能保存并重新读取；后续系统提示词应出现预期指导段落。**不要把含秘密的真实提示词上传公开 issue**。
4. 用新建的测试会话进行多轮对话、少量工具调用，确认可重启重载；如开启上下文打包，检查每条新替换标记都有 `data.id`。
5. 监测日志中的 `lacks an identified message`/`failed validation`；如出现，请立即关闭打包、备份日志，再报告脱敏诊断信息。
6. 费用、缓存 Token 与用量仪表盘属于估算与观察，不等于提供商计费账单。

**重要：** 旧的“禁止 DSH 主动回顾历史会话和扫描工作区”权限管理面板不再存在。本插件不提供文件操作的审批与访问沙箱。

See also: [upgrading & recovery](upgrade.md), [context packing](context-packing.md), [privacy](../PRIVACY.md).
