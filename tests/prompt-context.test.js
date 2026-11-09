import test from 'node:test'
import assert from 'node:assert/strict'

import { makeCore, makeCtx, session, sessionEvent } from './helpers.js'
import { planBudget, estimateTokens, TASK_PROFILES } from '../lib/context.js'

const longText = (n, ch = '规') => ch.repeat(n)

function assembly(overrides = {}) {
  return {
    sections: [
      { name: 'core-rules', text: 'core rules ' + longText(400) },
      { name: 'persona', text: 'core rules ' + longText(400) },
      { name: 'tools', text: longText(300, 't') },
    ],
    contexts: [{ name: 'cwd', text: 'E:/proj' }],
    tools: [{ name: 'read' }, { name: 'write' }],
    ...overrides,
  }
}

test('prompt: audit measures sections, contexts and duplicate blocks', () => {
  const core = makeCore()
  const report = core.prompt.analyze(assembly())
  assert.equal(report.sectionCount, 3)
  assert.equal(report.toolCount, 2)
  assert.equal(report.duplicates.length, 1)
  assert.deepEqual(report.duplicates[0].names, ['core-rules', 'persona'])
  assert.ok(report.totalChars > 1000)
  assert.ok(report.totalTokensEst > 300)
  assert.equal(core.prompt.latest(), null, 'analyze alone must not record history')
})

test('prompt: audit mode records the assembly but returns it untouched', async () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.prompt.attach(ctx)
  const input = assembly()
  const out = await ctx.emitAsync('system-prompt/assemble', input, {}, async () => input)
  assert.equal(out.sections.length, 3, 'audit mode must not drop sections')
  assert.equal(core.prompt.totals().assemblies, 1)
  assert.ok(core.prompt.latest().duplicates.length >= 1)
})

test('prompt: enforce + trimDuplicates removes the later duplicate only', async () => {
  const core = makeCore({ config: { mode: 'enforce', 'prompt.trimDuplicates': true } })
  const ctx = makeCtx()
  core.prompt.attach(ctx)
  const input = assembly()
  const out = await ctx.emitAsync('system-prompt/assemble', input, {}, async () => input)
  assert.equal(out.sections.length, 2)
  assert.equal(out.sections[0].name, 'core-rules')
  assert.equal(out.sections[1].name, 'tools')
  assert.ok(core.ledger.snapshot().metrics.today.promptCharsRemoved > 0)
  assert.equal(core.ledger.snapshot().metrics.today.promptSectionsTrimmed, 1)
})

test('prompt: enforce without trimDuplicates still keeps every section', async () => {
  const core = makeCore({ config: { mode: 'enforce' } })
  const ctx = makeCtx()
  core.prompt.attach(ctx)
  const input = assembly()
  const out = await ctx.emitAsync('system-prompt/assemble', input, {}, async () => input)
  assert.equal(out.sections.length, 3)
})

test('prompt: oversize assemblies raise an advisory alert', () => {
  const core = makeCore({ config: { 'context.defaultBudgetTokens': 1000 } })
  core.prompt.process({ sections: [{ name: 'huge', text: longText(20_000) }], contexts: [], tools: [] })
  const alert = core.anomaly.snapshot().recent.find((item) => item.kind === 'prompt-budget')
  assert.ok(alert)
  assert.match(alert.message, /超出预算/)
})

test('context: planBudget splits the window into L0/L1/L2 layers', () => {
  const plan = planBudget({ taskType: 'standard' })
  assert.equal(plan.contextTokens, TASK_PROFILES.standard.contextTokens)
  assert.equal(plan.outputReserve, TASK_PROFILES.standard.outputReserve)
  const { l0, l1, l2, tools } = plan.layers
  assert.ok(l0 > 0 && l1 > 0 && l2 > 0)
  assert.equal(tools, 0, 'no tools means no tool overhead')
  assert.ok(l0 + l1 + l2 <= plan.contextTokens, 'layers must fit inside the window')
  assert.ok(l0 + l1 + l2 >= plan.contextTokens - 3, 'layers must use the whole window')
  assert.equal(plan.layers.l3, 'on-demand only')

  const withTools = planBudget({ taskType: 'standard', toolCount: 20 })
  assert.ok(withTools.layers.tools > 0)
  assert.ok(withTools.layers.l0 + withTools.layers.l1 + withTools.layers.l2 + withTools.layers.tools <= withTools.contextTokens + 1)

  const cross = planBudget({ taskType: 'crossModule' })
  assert.ok(cross.contextTokens > plan.contextTokens)
})

test('context: estimateTokens rounds characters to a token estimate', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 2)
  assert.ok(estimateTokens(longText(3600)) >= 1000)
})

test('context: pressure sampling warns when the window is nearly full', () => {
  const core = makeCore({ config: { 'context.warnRatio': 0.5 } })
  const ctx = makeCtx({ services: { tokenMeter: { contextPressure: () => ({ pressureTokens: 110_000, contextWindow: 128_000 }) } } })
  core.context.attach(ctx)
  ctx.emit('session/event', session('s'), sessionEvent('turn/end', { turn: 1 }))
  const latest = core.context.latest('s')
  assert.equal(latest.tokens, 110_000)
  assert.ok(Math.abs(latest.ratio - 0.859375) < 1e-6)
  assert.ok(core.anomaly.snapshot().recent.some((item) => item.kind === 'context-pressure'))
  assert.equal(core.ledger.snapshot().metrics.today.contextPressureEvents, 1)
})

test('context: a missing tokenMeter degrades to no readings', () => {
  const core = makeCore()
  const ctx = makeCtx({ services: { tokenMeter: undefined } })
  core.context.attach(ctx)
  ctx.emit('session/event', session('s'), sessionEvent('turn/end', { turn: 1 }))
  assert.equal(core.context.latest('s'), null)
})
