# v0.3.6 GitHub 发布检查清单 / Release checklist

此清单用于维护者人工核对。只有完成全部适用步骤后，才对外宣称“已正式发布”。

## A. 代码与许可

- [ ] 确认拥有所有提交文件的版权、转授权权利及第三方依赖许可；批准 MIT 许可正文（本包不代表自动完成法律授权）。
- [ ] 确认 GitHub 仓库 owner、公开署名、维护联系渠道；删除示例占位符。
- [ ] 核对 `package.json.version`、Host `VERSION` 均为 `0.3.6`，保留唯一插件 ID `dsh-optimizer`。
- [ ] 核对 `lib/context-packing.js` 写入每个替换 `user/message` 的 `data.id`。
- [ ] 核对公开仓库不包含真实 `.dsh/`、`storages/`、`sessions/`、会话文件、账本、API key、私人路径、屏幕截图及原始验收报告。

## B. 质量检查

- [ ] `npm test` 通过（基线 **131/131**）。
- [ ] `npm run check` 通过。
- [ ] `npm run release:audit` 通过；并作人工隐私检查（自动检查不保证发现全部信息）。
- [ ] `npm pack --dry-run` 包清单正确，包含 `LICENSE`、`cordis.patch.yml`、`index.js`、`client.js`、`lib/`、`locale/`。
- [ ] 在与你声明兼容的 DSH 宿主上检查加载、配置、任务指导、上下文打包 2–3 轮、连续会话和**重启重载**；确认没有 `lacks an identified message` 错误。
- [ ] 如新增代码变更，重新测试，而非援引旧报告。

## C. GitHub Release

具体命令参见 [GitHub 发布操作](github-publish.md)。

- [ ] 用可信 GitHub 帐号创建公开仓库，上传 **解压后的源码**，不是把 ZIP 当唯一文件。
- [ ] 配置 main 分支保护、CI、Issues 与安全报告渠道。
- [ ] `git tag -a v0.3.6 -m 'DSH Optimizer v0.3.6'` 并推送 tag（基于已经验收的 commit）。
- [ ] 创建 GitHub Release `v0.3.6`，内容采用 [`RELEASE_NOTES_v0.3.6.md`](../RELEASE_NOTES_v0.3.6.md)，可附生成的 tgz 包及其 SHA256。
- [ ] 仓库主页注明“社区非官方”、宿主版本范围、Token/费用非保证、0.3.5 已知故障及旧会话不自动恢复。

## D. 市场索引（可选）

- [ ] 取得真实 GitHub URL 和 40 位 commit SHA 后运行 `scripts/generate-market-index.mjs`。
- [ ] 索引使用真实 git source、固定 commit、受测试的 DSH 兼容范围。
- [ ] HTTPS 托管 index 和 icon；用全新 DSH profile 实测安装/卸载。
- [ ] 未经核实不要称其为 DSH 官方收录或官方认证。
