# 在 DSH 自定义插件索引中发布 / Publish to a custom DSH plugin index

**GitHub 源码仓库 ≠ 自动出现在 DSH 的任何官方市场。** DSH 有“自定义插件索引”实验功能，可让用户在 Discover 中添加独立托管的 HTTPS JSON 索引；不同第三方目录可能有独立审核流程。

官方参考：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md

## 第一步：发布真实仓库

1. 先执行 `npm test && npm run check && npm run release:audit`，并人工完成 [发布清单](../docs/release-checklist.md)。
2. 确认代码版权和 LICENSE，创建你**自己的**公开 GitHub 仓库。以本包**解压后文件**作为仓库根目录，`package.json` 与 `cordis.patch.yml` 均在根目录。
3. 推送后创建真实 Git tag `v0.3.6` 和 Release（描述可直接采用 [`RELEASE_NOTES_v0.3.6.md`](../RELEASE_NOTES_v0.3.6.md)）。获取对应提交的真实 **40 位** Git SHA。

## 第二步：生成可审计的市场索引

```bash
node scripts/generate-market-index.mjs \
  --repo https://github.com/YOUR_ACCOUNT/dsh-optimizer \
  --commit ACTUAL_40_HEX_COMMIT_SHA \
  --author 'YOUR_PUBLIC_NAME' \
  --dsh-range '2.0.21-next'
```

**所有 `YOUR_*`、`ACTUAL_*` 都是示意占位符，不可照抄发布**。脚本拒绝无效 URL、伪 SHA 和空作者信息。建议 `--dsh-range` 只标你实际验证过的 DSH 版本，不要凭猜测宣称全版本兼容。

将生成的 `site/index.json` 与 `site/icons/dsh-optimizer.svg` 托管在 HTTPS 静态站点（例如 GitHub Pages）。**在仓库真实地址和提交 SHA 出现前无法生成有效的正式索引。**

## 第三步：自己检查安装流程

在隔离 DSH profile 中启用实验性的 Custom plugin indexes，添加 HTTPS 索引 URL，确认插件名、版本、仓库、40 位 commit 都正确，再执行安装与卸载。插件上架不表示官方安全审核已通过。
