/**
 * Report builder: one JSON snapshot plus a human-readable Markdown brief.
 *
 * Reports are written on demand (UI button, `/optimizer` command, or the
 * benchmark script) — never on a timer, so a quiet DSH stays quiet. The numbers
 * come from the same ledger the UI shows, and the file states which pricing
 * version produced the estimate.
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeJson } from './store.js'
import { dayKey, stamp } from './paths.js'

const usd = (value) => `$${Number(value ?? 0).toFixed(4)}`
const pct = (value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`
const num = (value) => Number(value ?? 0).toLocaleString('en-US')

export function buildReport(host) {
  const status = host.status()
  const ledger = status.ledger
  const today = ledger.today
  const project = ledger.project
  return {
    generatedAt: new Date().toISOString(),
    plugin: status.plugin,
    pricingVersion: ledger.pricingVersion,
    today,
    project,
    series: ledger.series,
    sessionsTop: ledger.sessionsTop,
    metrics: ledger.metrics,
    budget: status.budget,
    anomalies: status.anomalies,
    prompt: status.prompt?.latest ?? null,
    context: status.context,
    toolResult: status.toolResult,
    checkpoints: status.checkpoints,
    modules: status.modules,
  }
}

export function renderMarkdown(report) {
  const lines = []
  lines.push(`# DSH Optimizer 报告 — ${dayKey(new Date(report.generatedAt))}`)
  lines.push('')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 插件版本：${report.plugin?.version}（模式 ${report.plugin?.mode}）`)
  lines.push(`- 计价版本：${report.pricingVersion}`)
  lines.push('')
  lines.push('## 今日')
  lines.push('')
  lines.push('| 指标 | 值 |')
  lines.push('|---|---:|')
  lines.push(`| 请求数 | ${num(report.today?.requests)} |`)
  lines.push(`| 输入 Token | ${num(report.today?.inputTokens)} |`)
  lines.push(`| 缓存命中 Token | ${num(report.today?.cachedInputTokens)} |`)
  lines.push(`| 未命中输入 Token | ${num(report.today?.uncachedInputTokens)} |`)
  lines.push(`| 输出 Token | ${num(report.today?.outputTokens)} |`)
  lines.push(`| 缓存命中率 | ${pct(report.today?.cacheHitRate)} |`)
  lines.push(`| 估算费用 | ${usd(report.today?.costUSD)} |`)
  lines.push('')
  lines.push('## 累计（本项目状态目录）')
  lines.push('')
  lines.push(`- 请求 ${num(report.project?.requests)}，输入 ${num(report.project?.inputTokens)}，输出 ${num(report.project?.outputTokens)}`)
  lines.push(`- 缓存命中率 ${pct(report.project?.cacheHitRate)}，估算费用 ${usd(report.project?.costUSD)}`)
  lines.push(`- 预算：日 ${usd(report.budget?.scopes?.day?.usedUSD)} / ${usd(report.budget?.scopes?.day?.limitUSD)}；项目 ${usd(report.budget?.scopes?.project?.usedUSD)} / ${usd(report.budget?.scopes?.project?.limitUSD)}`)
  lines.push('')
  const metrics = report.metrics?.today ?? {}
  lines.push('## 优化动作')
  lines.push('')
  lines.push(`- 工具结果精简：${num(metrics.toolResultsPruned)} 次，节省 ${num(metrics.toolCharsPruned)} 字符（约 ${num(report.toolResult?.savedTokensEst)} tokens）`)
  lines.push(`- 重复工具结果去重：${num(metrics.toolResultsDeduped)} 次`)
  lines.push(`- 提示词裁剪：${num(metrics.promptSectionsTrimmed)} 段，${num(metrics.promptCharsRemoved)} 字符`)
  lines.push(`- 检查点写入：${num(metrics.checkpoints)} 次；恢复检查：${num(metrics.recoveryChecks)} 次`)
  lines.push(`- 异常告警：${num(metrics.anomalies)} 条`)
  lines.push('')
  lines.push('## 最近 7 天')
  lines.push('')
  lines.push('| 日期 | 请求 | 输入 | 缓存 | 未命中 | 输出 | 命中率 | 估算费用 |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const day of (report.series ?? []).slice(-7)) {
    lines.push(`| ${day.day} | ${num(day.requests)} | ${num(day.inputTokens)} | ${num(day.cachedInputTokens)} | ${num(day.uncachedInputTokens)} | ${num(day.outputTokens)} | ${pct(day.cacheHitRate)} | ${usd(day.costUSD)} |`)
  }
  lines.push('')
  if (report.anomalies?.recent?.length) {
    lines.push('## 异常')
    lines.push('')
    for (const alert of report.anomalies.recent.slice(0, 10)) {
      lines.push(`- ${alert.ts} [${alert.kind}/${alert.severity}] ${alert.message}`)
    }
    lines.push('')
  }
  lines.push('> 费用为按公开价格表与时间窗计算的估算值，不是供应商账单。缓存命中与未命中 Token 已分别计价。')
  lines.push('')
  return lines.join('\n')
}

export function writeReport(host) {
  const report = buildReport(host)
  const base = path.join(host.paths.root, 'reports', `report-${stamp(new Date(report.generatedAt))}`)
  const markdown = renderMarkdown(report)
  writeJson(`${base}.json`, report)
  fs.writeFileSync(`${base}.md`, markdown)
  return { files: [`${base}.json`, `${base}.md`], report, markdown }
}
