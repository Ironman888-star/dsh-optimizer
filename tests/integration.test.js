import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createHost, PLUGIN_ID, VERSION } from '../lib/host.js'
import { makeCtx, tempHome, session, sessionEvent, headerEvent, assistantEvent, makeReq, callRoute, silentLog } from './helpers.js'

function boot(options = {}) {
  const ctx = makeCtx()
  const home = options.home ?? tempHome()
  const host = createHost({ root: ctx, home, log: silentLog })
  host.start()
  return { ctx, host, home }
}

test('integration: a boot mounts every route and every module', () => {
  const { ctx, host } = boot()
  assert.equal(ctx.routes.size, 7)
  const modules = host.status().modules
  const byId = Object.fromEntries(modules.map((item) => [item.id, item.state]))
  assert.equal(byId.server, 'mounted')
  assert.equal(byId.taskInstructions, 'mounted')
  assert.equal(byId.accessGuard, undefined)
  assert.equal(byId.ledger, 'mounted')
  assert.equal(byId.anomaly, 'mounted')
  assert.equal(byId.toolResult, 'mounted')
  assert.equal(byId.prompt, 'mounted')
  assert.equal(byId.checkpoint, 'mounted')
  assert.equal(byId.context, 'mounted')
  assert.equal(byId.housekeeping, 'mounted')
  host.dispose()
})

test('integration: status aggregates the ledger, budget and checkpoints', async () => {
  const { ctx, host } = boot()
  const s = session('sess-int')
  ctx.emit('session/event', s, headerEvent())
  ctx.emit('session/event', s, assistantEvent({ inputTokens: 10000, cacheReadTokens: 8000, outputTokens: 500 }))
  ctx.emit('session/event', s, sessionEvent('turn/end', { turn: 1, reason: 'done' }))

  const res = await callRoute(ctx, '/dsh-optimizer/state.json')
  const state = res.json()
  assert.equal(state.ok, true)
  assert.equal(state.plugin.id, PLUGIN_ID)
  assert.equal(state.plugin.version, VERSION)
  assert.equal(state.ledger.today.billedRequests, 1)
  assert.equal(state.ledger.today.cachedInputTokens, 8000)
  assert.equal(state.budget.scopes.day.state, 'ok')
  assert.equal(state.checkpoints.items.length, 1)
  host.dispose()
})

test('integration: pause and resume round-trip through the HTTP action route', async () => {
  const { ctx, host } = boot()
  const paused = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({
    method: 'POST',
    body: JSON.stringify({ name: 'pause', payload: { reason: '测试暂停' } }),
  }))
  assert.equal(paused.json().ok, true)
  assert.equal(host.status().plugin.paused, true)
  assert.match(host.status().plugin.pauseReason, /测试暂停/)

  const resumed = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', body: JSON.stringify({ action: 'resume' }) }))
  assert.equal(resumed.json().ok, true)
  assert.equal(host.status().plugin.paused, false)
  host.dispose()
})

test('integration: setMode validates and persists', async () => {
  const { ctx, host } = boot()
  const ok = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', body: JSON.stringify({ name: 'setMode', payload: { mode: 'enforce' } }) }))
  assert.equal(ok.json().ok, true)
  assert.equal(host.config.get('mode'), 'enforce')
  const bad = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', body: JSON.stringify({ name: 'setConfig', payload: { path: 'budgets.dailyUSD', value: -3 } }) }))
  assert.equal(bad.json().ok, false)
  assert.equal(host.config.get('budgets.dailyUSD'), 5)
  host.dispose()
})

test('integration: unknown actions fail closed', async () => {
  const { ctx, host } = boot()
  const res = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', body: JSON.stringify({ name: 'rm-rf' }) }))
  assert.equal(res.json().ok, false)
  assert.match(res.json().errors[0], /未知操作/)
  host.dispose()
})

test('integration: a disabled plugin still serves status but stops optimizing', () => {
  const first = boot()
  const configFile = first.host.config.file
  first.host.dispose()
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  raw.enabled = false
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2))

  const { ctx, host } = boot({ home: first.home })
  const modules = Object.fromEntries(host.status().modules.map((item) => [item.id, item.state]))
  assert.equal(modules.server, 'mounted')
  assert.equal(modules.ledger, undefined, 'optimizers must not mount while disabled')
  assert.equal(ctx.routes.size, 7, 'status/config routes stay reachable so the owner can re-enable')

  ctx.emit('session/event', session('s'), headerEvent())
  ctx.emit('session/event', session('s'), assistantEvent({ inputTokens: 1000, outputTokens: 100 }))
  assert.equal(host.status().ledger.today.billedRequests, 0)
  host.dispose()
})

test('integration: report writes both json and markdown artifacts', () => {
  const { host } = boot()
  const result = host.report()
  assert.equal(result.files.length, 2)
  for (const file of result.files) {
    assert.equal(fs.existsSync(file), true)
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(text.length > 20)
  }
  assert.ok(result.files.some((file) => file.endsWith('.md')))
  host.dispose()
})

test('integration: dispose flushes the ledger and removes routes', () => {
  const { ctx, host } = boot()
  const s = session('s')
  ctx.emit('session/event', s, headerEvent())
  ctx.emit('session/event', s, assistantEvent({ inputTokens: 1000, outputTokens: 100 }))
  host.dispose()
  assert.equal(ctx.routes.size, 0)
  const stateFile = path.join(host.paths.root, 'state', 'ledger.json')
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  assert.equal(saved.project.billedRequests, 1)
})

test('integration: a fresh host reloads the ledger written by the previous boot', () => {
  const first = boot()
  const ctx = first.ctx
  ctx.emit('session/event', session('s'), headerEvent())
  ctx.emit('session/event', session('s'), assistantEvent({ inputTokens: 2000, outputTokens: 200 }))
  const root = first.host.paths.root
  first.host.dispose()

  const ctx2 = makeCtx()
  const host2 = createHost({ root: ctx2, home: first.home })
  host2.start()
  assert.equal(host2.paths.root, root)
  assert.equal(host2.status().ledger.project.billedRequests, 1)
  assert.equal(host2.status().ledger.project.inputTokens, 2000)
  host2.dispose()
})
