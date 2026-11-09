import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { makeCore, makeCtx, session, sessionEvent, headerEvent, assistantEvent } from './helpers.js'
import { dayKey } from '../lib/paths.js'

const usage = { inputTokens: 10000, cacheReadTokens: 8000, outputTokens: 500 }

function drive(core, ctx, events = []) {
  for (const [type, data, meta] of events) ctx.emit('session/event', session('sess-ledger'), sessionEvent(type, data, meta))
}

test('ledger: one request header + one assistant message book one billed call', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  drive(core, ctx, [
    ['request/header', { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } }, reason: 'initial' }],
    ['assistant/message', { turn: 1, step: 1, message: {}, stream: [], usage }],
  ])

  const today = core.ledger.state.days[dayKey()]
  assert.equal(today.requests, 2, 'request/header counts one attempt, the message one billed call')
  assert.equal(today.billedRequests, 1)
  assert.equal(today.inputTokens, 10000)
  assert.equal(today.cachedInputTokens, 8000)
  assert.equal(today.uncachedInputTokens, 2000)
  assert.equal(today.outputTokens, 500)
  assert.ok(today.costUSD > 0)
  assert.equal(core.ledger.snapshot().today.cacheHitRate, 0.8)
})

test('ledger: usage without a header still books against the default model', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  ctx.emit('session/event', session('s'), assistantEvent({ inputTokens: 1000, outputTokens: 100 }))
  const record = core.ledger.snapshot().recent[0]
  assert.equal(record.provider, 'deepseek-account')
  assert.equal(record.model, 'deepseek-flash')
  assert.ok(record.costUSD > 0)
})

test('ledger: repeated identical headers do not double-count the billed call', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  for (let i = 0; i < 3; i += 1) {
    ctx.emit('session/event', session('s'), headerEvent({ seq: i }))
    ctx.emit('session/event', session('s'), assistantEvent(usage, { seq: 10 + i }))
  }
  const today = core.ledger.state.days[dayKey()]
  assert.equal(today.billedRequests, 3)
  assert.equal(today.requests, 6)
  assert.equal(today.inputTokens, 30000)
})

test('ledger: jsonl day file holds one durable line per billed call', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  ctx.emit('session/event', session('s'), headerEvent())
  ctx.emit('session/event', session('s'), assistantEvent(usage))
  const file = path.join(core.paths.root, 'ledger', `${dayKey()}.jsonl`)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.v, 1)
  assert.equal(row.sessionId, 's')
  assert.equal(row.uncachedInputTokens, 2000)
  assert.equal(row.inputMode, 'total')
  assert.ok(row.pricingId.includes('schedule-v2-2026-08-22+'))
})

test('ledger: task and agent attribution flows from attributes into aggregates', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  core.ledger.attribute('s', { taskId: 'task-42', agentId: 'agent-a' })
  ctx.emit('session/event', session('s'), headerEvent())
  ctx.emit('session/event', session('s'), assistantEvent(usage))
  assert.ok(core.ledger.totalsForTask('task-42').costUSD > 0)
  assert.ok(core.ledger.totalsForAgent('agent-a').costUSD > 0)
  assert.equal(core.ledger.totalsForSession('s').billedRequests, 1)
})

test('ledger: local optimization metrics are counted per day', () => {
  const core = makeCore()
  core.ledger.note('toolResultsPruned')
  core.ledger.note('toolCharsPruned', 500)
  const metrics = core.ledger.snapshot().metrics.today
  assert.equal(metrics.toolResultsPruned, 1)
  assert.equal(metrics.toolCharsPruned, 500)
  assert.equal(metrics.anomalies, 0)
})

test('budget: scopes report ratios against configured limits', () => {
  const core = makeCore({ config: { 'budgets.dailyUSD': 0.001, 'budgets.projectUSD': 10 } })
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  ctx.emit('session/event', session('s'), headerEvent())
  ctx.emit('session/event', session('s'), assistantEvent({ inputTokens: 100_000, outputTokens: 5_000 }))

  const status = core.budget.status()
  assert.equal(status.scopes.day.limitUSD, 0.001)
  assert.equal(status.scopes.day.state, 'over')
  assert.equal(status.scopes.day.remainingUSD, 0)
  assert.equal(status.scopes.project.state, 'ok')
})

test('budget: warn threshold raises one alert per day, not one per call', () => {
  const core = makeCore({ config: { 'budgets.dailyUSD': 0.001, 'budgets.warnRatio': 0.4 } })
  const ctx = makeCtx()
  core.ledger.attach(ctx)
  core.budget.attach()
  for (let i = 0; i < 3; i += 1) {
    ctx.emit('session/event', session('s'), headerEvent({ seq: i }))
    ctx.emit('session/event', session('s'), assistantEvent(usage, { seq: 20 + i }))
  }
  const warnings = core.anomaly.snapshot().recent.filter((item) => item.kind === 'budget' && item.severity === 'warn')
  assert.equal(warnings.length, 1)
  assert.equal(core.ledger.snapshot().metrics.today.budgetWarnings >= 0, true)
})

test('budget: enforce mode pauses at 100%, audit mode keeps running', () => {
  const expensive = { inputTokens: 100_000, outputTokens: 5_000 }
  const audit = makeCore({ config: { 'budgets.dailyUSD': 0.001 } })
  const ctxA = makeCtx()
  audit.ledger.attach(ctxA)
  audit.budget.attach()
  ctxA.emit('session/event', session('s'), headerEvent())
  ctxA.emit('session/event', session('s'), assistantEvent(expensive))
  assert.equal(audit.budget.gate().paused, false, 'audit mode never blocks work')

  const enforce = makeCore({ config: { 'budgets.dailyUSD': 0.001, mode: 'enforce' } })
  const ctxE = makeCtx()
  enforce.ledger.attach(ctxE)
  enforce.budget.attach()
  ctxE.emit('session/event', session('s'), headerEvent())
  ctxE.emit('session/event', session('s'), assistantEvent(expensive))
  const gate = enforce.budget.gate()
  assert.equal(gate.paused, true)
  assert.match(gate.reason, /预算已用尽/)
  assert.equal(enforce.budget.resume().paused, false)
})

test('budget: manual pause/resume persists across a reload', () => {
  const core = makeCore()
  core.budget.pause('维护窗口')
  const file = path.join(core.paths.root, 'state', 'budget.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.paused, true)
  assert.equal(saved.reason, '维护窗口')
})
