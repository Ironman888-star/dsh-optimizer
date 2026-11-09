import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createServer } from '../lib/server.js'
import { makeCore, makeCtx, makeReq, callRoute, silentLog } from './helpers.js'

function fakeHost(core, overrides = {}) {
  const calls = []
  const host = {
    calls,
    paths: core.paths,
    config: {
      file: path.join(core.paths.root, 'config.json'),
      snapshot: () => core.config.snapshot(),
      get: (key) => core.config.get(key),
    },
    status: () => ({ plugin: { id: 'dsh-optimizer', paused: false }, modules: [] }),
    reportSnapshot: () => ({ generatedAt: 'now', totals: {} }),
    actions: (name, payload) => { calls.push([name, payload]); return { ok: true, action: name } },
    ...overrides,
  }
  return host
}

function mount(core, options = {}) {
  const host = fakeHost(core, options.host)
  const ctx = makeCtx()
  const server = createServer({ core, host, log: silentLog })
  server.attach(ctx)
  return { host, ctx, server }
}

test('server: state.json answers a loopback same-origin GET with JSON', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const res = await callRoute(ctx, '/dsh-optimizer/state.json')
  assert.equal(res.state.status, 200)
  assert.equal(res.state.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.state.headers['cache-control'], 'no-store')
  assert.equal(res.json().ok, true)
  assert.equal(res.json().plugin.id, 'dsh-optimizer')
})

test('server: dashboard is HTML and config/report routes are JSON', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const dash = await callRoute(ctx, '/dsh-optimizer/dashboard')
  assert.equal(dash.state.status, 200)
  assert.match(dash.state.headers['content-type'], /text\/html/)
  assert.match(dash.state.body, /dsh-optimizer/)

  const report = await callRoute(ctx, '/dsh-optimizer/report.json')
  assert.equal(report.json().ok, true)
  const config = await callRoute(ctx, '/dsh-optimizer/config.json')
  assert.equal(config.json().ok, true)
  assert.equal(config.json().config.mode, 'audit')
})

test('server: non-loopback Host headers are refused', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const res = await callRoute(ctx, '/dsh-optimizer/state.json', makeReq({ headers: { host: 'example.com' } }))
  assert.equal(res.state.status, 403)
  assert.equal(res.json().ok, false)
})

test('server: cross-site fetches and mismatched origins are refused', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const cross = await callRoute(ctx, '/dsh-optimizer/state.json', makeReq({ headers: { host: '127.0.0.1:60110', 'sec-fetch-site': 'cross-site' } }))
  assert.equal(cross.state.status, 403)

  const evil = await callRoute(ctx, '/dsh-optimizer/state.json', makeReq({ headers: { host: '127.0.0.1:60110', origin: 'http://evil.example' } }))
  assert.equal(evil.state.status, 403)

  const sameOrigin = await callRoute(ctx, '/dsh-optimizer/state.json', makeReq({ headers: { host: '127.0.0.1:60110', origin: 'http://127.0.0.1:60110' } }))
  assert.equal(sameOrigin.state.status, 200)
})

test('server: a host connection fence can veto a request', async () => {
  const core = makeCore()
  const host = fakeHost(core)
  const ctx = makeCtx({ services: { connection: { requestRejection: () => 'blocked by host policy' } } })
  createServer({ core, host, log: silentLog }).attach(ctx)
  const res = await callRoute(ctx, '/dsh-optimizer/state.json')
  assert.equal(res.state.status, 403)
})

test('server: GET-only routes reject POST, the action route rejects GET', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const posted = await callRoute(ctx, '/dsh-optimizer/state.json', makeReq({ method: 'POST' }))
  assert.equal(posted.state.status, 405)
  const got = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'GET' }))
  assert.equal(got.state.status, 405)
})

test('server: actions are forwarded with the client payload shape', async () => {
  const core = makeCore()
  const { host, ctx } = mount(core)
  const res = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({
    method: 'POST',
    body: JSON.stringify({ name: 'pause', payload: { reason: '手动' } }),
  }))
  assert.equal(res.json().ok, true)
  assert.deepEqual(host.calls.at(-1), ['pause', { reason: '手动' }])

  const dashShape = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({
    method: 'POST',
    body: JSON.stringify({ action: 'report' }),
  }))
  assert.equal(dashShape.json().ok, true)
  assert.equal(host.calls.at(-1)[0], 'report')
})

test('server: config writes are blocked when allowConfigWrite is false', async () => {
  const core = makeCore({ config: { 'server.allowConfigWrite': false } })
  const { host, ctx } = mount(core)
  const res = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({
    method: 'POST',
    body: JSON.stringify({ name: 'setMode', payload: { mode: 'enforce' } }),
  }))
  assert.equal(res.json().ok, false)
  assert.equal(host.calls.length, 0)
})

test('server: invalid JSON bodies fail closed without touching the host', async () => {
  const core = makeCore()
  const { host, ctx } = mount(core)
  const res = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', body: '{oops' }))
  assert.equal(res.state.status, 500)
  assert.equal(res.json().ok, false)
  assert.equal(host.calls.length, 0)
})

test('spill: only files inside the spill directory are served, by base name', async () => {
  const core = makeCore()
  const { ctx } = mount(core)
  const spillDir = path.join(core.paths.root, 'spill')
  fs.writeFileSync(path.join(spillDir, 'out.txt'), 'hello spill')

  const ok = await callRoute(ctx, '/dsh-optimizer/spill.json', makeReq({ url: '/dsh-optimizer/spill.json?name=out.txt' }))
  assert.equal(ok.json().ok, true)
  assert.equal(ok.json().text, 'hello spill')

  const traversal = await callRoute(ctx, '/dsh-optimizer/spill.json', makeReq({ url: '/dsh-optimizer/spill.json?name=../../config.json' }))
  assert.equal(traversal.json().ok, false)

  const missing = await callRoute(ctx, '/dsh-optimizer/spill.json', makeReq({ url: '/dsh-optimizer/spill.json?name=nope.txt' }))
  assert.equal(missing.json().ok, false)
})

test('server: detaching the context removes every route', () => {
  const core = makeCore()
  const host = fakeHost(core)
  const ctx = makeCtx()
  const server = createServer({ core, host, log: silentLog })
  const dispose = server.attach(ctx)
  assert.equal(server.isMounted(), true)
  assert.equal(ctx.routes.size, 7)
  dispose()
  assert.equal(ctx.routes.size, 0)
  assert.equal(server.isMounted(), false)
})
