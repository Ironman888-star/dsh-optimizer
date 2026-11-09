# GitHub 公开仓库发布操作 / GitHub publishing steps

本项目**尚未由本地打包动作自动发布**。需要仓库拥有者本人确认代码再许可、公开署名和仓库权限，再将源码推送到 GitHub。

## 1. 发布前检查

在解压后的 `dsh-optimizer` 源码根目录运行：

```bash
npm test
npm run check
npm run release:audit
npm pack --dry-run
```

人工确认 `.gitignore` 有效；仓库中没有本机 DSH 配置、会话备份、账本、`*.jsonl.zstd`、模型密钥及私人路径。**不要将本机生产 `config.json` 或真实会话复制进仓库。**

## 2. 建立 GitHub 仓库

在 GitHub 新建名为 `dsh-optimizer` 的 **Public** 仓库（推荐先用 Private 校验再转 Public）。仓库 URL 由你实际账号决定，下方 `<YOUR_GITHUB_USER>` 必须手动替换。

将 ZIP **解压出来的文件**放在仓库根目录，而不是把 ZIP 当成唯一仓库内容。不要同时使用 GitHub 的模板 README 或 LICENSE 自动生成选项造成文件冲突；包内已有这些文件。

如果当前目录尚不是 Git 仓库，可在本地执行：

```bash
git init -b main
git add .
git status --short
git commit -m "Release DSH Optimizer v0.3.6"
git remote add origin https://github.com/<YOUR_GITHUB_USER>/dsh-optimizer.git
git push -u origin main
```

**这些是操作示例，不会自动执行。** `git status` 中如出现私人文件，立即停止并移除敏感内容后再提交。

## 3. Tag 和 Release

在确认测试通过且推送到 GitHub 的真实提交后：

```bash
git tag -a v0.3.6 -m "DSH Optimizer v0.3.6"
git push origin v0.3.6
git rev-parse v0.3.6^{}
```

核对 tag 指向的真实 Git 40 位 SHA，在 GitHub 的 Releases → Draft a new release 中选择 `v0.3.6`，把 [`RELEASE_NOTES_v0.3.6.md`](../RELEASE_NOTES_v0.3.6.md) 作为发布说明，可附带单独提供的 npm `.tgz` 文件和 SHA256SUMS。

发布说明中突出：**0.3.5 已知会话损坏缺陷已在 0.3.6 修复；升级不能自动修复旧数据**。完成发布后，可以选择配置 GitHub Pages 的 DSH 自定义插件索引，见 [市场文档](../market/README.md)。

## 4. 发布后烟雾测试

在全新或隔离 DSH profile 中，使用公开 Git 标签的实际 Git URL 安装；检查插件 ID、版本、前端设置页、最近轮数打包（含 UUID）、任务指导注入及重启重载。使用者应自行批准安装行为，不能把自动化测试视为生产环境兼容性认证。
