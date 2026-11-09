import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { makeCore, makeCtx, session, sessionEvent, assistantEvent } from './helpers.js'

function toolResult(toolName, error = null) {
  return sessionEvent('tool/result', {
    turn: 1,
    step: 1,
    callId: `c-${toolName}`,
    message: { toolName },
    error: error ?? undefined,
  })
}

test('anomaly: repeated failures of one tool raise a traceable alert', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('sess-1')
  for (let i = 0; i < 3; i += 1) ctx.emit('session/event', s, toolResult('pwsh', { name: 'Error', code: 'EPERM' }))

  const alerts = core.anomaly.recent().filter((item) => item.kind === 'repeat-failure')
  assert.equal(alerts.length, 1, 'cooldown must collapse the burst into one alert')
  assert.match(alerts[0].message, /pwsh 连续失败 3 次/)
  assert.equal(alerts[0].data.code, 'EPERM')
  assert.ok(alerts[0].id.startsWith('an_'))
  assert.equal(core.ledger.snapshot().metrics.today.anomalies, 1)
})

test('anomaly: a successful call resets the failure counter', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  ctx.emit('session/event', s, toolResult('pwsh', { name: 'Error' }))
  ctx.emit('session/event', s, toolResult('pwsh', { name: 'Error' }))
  ctx.emit('session/event', s, toolResult('pwsh'))
  ctx.emit('session/event', s, toolResult('pwsh', { name: 'Error' }))
  assert.equal(core.anomaly.recent().filter((item) => item.kind === 'repeat-failure').length, 0)
})

test('anomaly: identical tool calls in a window are flagged as a loop', () => {
  const core = makeCore({ config: { 'anomaly.windowMs': 600_000 } })
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  for (let i = 0; i < 3; i += 1) {
    ctx.emit('session/event', s, sessionEvent('tool/call', { turn: 1, step: 1, callId: `c${i}`, name: 'pwsh', arguments: { command: 'git status' } }))
  }
  const loops = core.anomaly.recent().filter((item) => item.kind === 'tool-loop')
  assert.equal(loops.length, 1)
  assert.match(loops[0].message, /相同参数调用 3 次/)
})

test('anomaly: repeated reads are advisory, not errors', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  for (let i = 0; i < 3; i += 1) {
    ctx.emit('session/event', s, sessionEvent('tool/call', { turn: 1, step: 1, callId: `c${i}`, name: 'read', arguments: { file_path: 'lib/a.js' } }))
  }
  const reads = core.anomaly.recent().filter((item) => item.kind === 'repeated-read')
  assert.equal(reads.length, 1)
  assert.equal(reads[0].severity, 'info')
})

test('anomaly: a request burst above the configured rate is flagged', () => {
  const core = makeCore({ config: { 'anomaly.requestsPerMinute': 3 } })
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  for (let i = 0; i < 5; i += 1) {
    ctx.emit('session/event', s, sessionEvent('request/header', { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } }, reason: 'initial' }, { seq: i, time: Date.now() }))
  }
  const bursts = core.anomaly.recent().filter((item) => item.kind === 'request-burst')
  assert.equal(bursts.length, 1)
  assert.match(bursts[0].message, /每分钟 4 次/)
})

test('anomaly: a collapse in cache hit rate is flagged against the session baseline', () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  // 8 well-cached calls, then 5 mostly-uncached ones.
  for (let i = 0; i < 8; i += 1) {
    ctx.emit('session/event', s, assistantEvent({ inputTokens: 10_000, cacheReadTokens: 9_000, outputTokens: 100 }, { seq: i }))
  }
  for (let i = 0; i < 5; i += 1) {
    ctx.emit('session/event', s, assistantEvent({ inputTokens: 10_000, cacheReadTokens: 1_000, outputTokens: 100 }, { seq: 20 + i }))
  }
  const drops = core.anomaly.recent().filter((item) => item.kind === 'cache-hit-drop')
  assert.equal(drops.length, 1)
  assert.ok(drops[0].data.baseline > drops[0].data.recent)
})

test('anomaly: alerts append to a durable jsonl file', () => {
  const core = makeCore()
  const record = core.anomaly.alert('test-kind', { sessionId: 's', message: 'hello', severity: 'warn' })
  assert.ok(record)
  const file = path.join(core.paths.root, 'anomalies.jsonl')
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'test-kind')
})

test('anomaly: disabling the module stops all detection', () => {
  const core = makeCore({ config: { 'anomaly.enabled': false } })
  const ctx = makeCtx()
  core.anomaly.attach(ctx)
  const s = session('s')
  for (let i = 0; i < 6; i += 1) ctx.emit('session/event', s, toolResult('pwsh', { name: 'Error' }))
  assert.equal(core.anomaly.snapshot().recent.length, 0)
})
