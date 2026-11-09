/**
 * Test harness: a fake Cordis scope plus per-test state roots.
 *
 * The plugin only ever talks to the Host through `ctx.on`, `ctx.get`,
 * `ctx.effect`, `ctx.timer`, `ctx.webServer.register` and `root.inject`, so a
 * small object with those five shapes is enough to exercise every module without
 * booting DSH.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ensureLayout } from '../lib/paths.js'
import { createConfigStore } from '../lib/config.js'
import { createLedger } from '../lib/ledger.js'
import { createAnomaly } from '../lib/anomaly.js'
import { createBudget } from '../lib/budget.js'
import { createToolResult } from '../lib/toolresult.js'
import { createPromptAudit } from '../lib/prompt.js'
import { createContextBudget } from '../lib/context.js'
import { createCheckpoint } from '../lib/checkpoint.js'
import * as pricing from '../lib/pricing.js'

/** Point DSH_HOME at a fresh temp dir and return it. */
export function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-optimizer-test-'))
  process.env.DSH_HOME = dir
  return dir
}

export const silentLog = { info() {}, warn() {}, error() {}, debug() {} }

/** Build every module on a temp state root, wired the way host.js wires them. */
export function makeCore(options = {}) {
  const home = tempHome()
  const root = path.join(home, 'storages', 'dsh-optimizer')
  ensureLayout(root)
  const config = createConfigStore({ file: path.join(root, 'config.json'), log: silentLog })
  const core = {
    root: null,
    paths: { root },
    log: silentLog,
    config,
    pricing,
    version: 'test',
    now: options.now ?? (() => new Date()),
  }
  core.ledger = createLedger(core)
  core.anomaly = createAnomaly(core)
  core.budget = createBudget(core)
  core.toolresult = createToolResult(core)
  core.prompt = createPromptAudit(core)
  core.context = createContextBudget(core)
  core.checkpoint = createCheckpoint(core)
  for (const [key, value] of Object.entries(options.config ?? {})) config.set(key, value)
  return core
}

/** Fake Cordis scope. `inject` mounts synchronously; `emit` replays listeners. */
export function makeCtx(options = {}) {
  const listeners = new Map()
  const routes = new Map()
  const timers = []
  const promptSections = new Map()
  const services = {
    sessions: {},
    tools: {},
    systemPrompt: { section(spec) { promptSections.set(spec.name, spec); return () => promptSections.delete(spec.name) } },
    tokenMeter: {
      contextPressure: () => ({ pressureTokens: 40_000, contextWindow: 128_000 }),
      measure: () => ({ totalTokens: 40_000, baseline: { kind: 'none', tokens: 0 } }),
    },
    ...options.services,
  }

  const ctx = {
    services,
    listeners,
    routes,
    timers,
    promptSections,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {
        const list = listeners.get(event) ?? []
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    get(name) {
      return services[name]
    },
    has(name) {
      return services[name] !== undefined
    },
    inject(deps, callback) {
      return callback(ctx)
    },
    effect(fn) {
      return fn()
    },
    timer: {
      interval(callback, ms) {
        timers.push({ kind: 'interval', callback, ms })
        return () => {}
      },
      timeout() {
        return () => {}
      },
      throttle(callback) {
        return callback
      },
      debounce(callback) {
        return callback
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      getOrigin: () => 'http://127.0.0.1:60110',
    },
    logger: silentLog,
  }

  ctx.emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  ctx.emitAsync = async (event, ...args) => {
    let result
    for (const listener of listeners.get(event) ?? []) result = await listener(...args)
    return result
  }
  return ctx
}

export function sessionEvent(type, data, { seq = 1, time = Date.now() } = {}) {
  return { type, seq, time, data }
}

export function session(id = 'session-test') {
  return { id }
}

export function headerEvent({ provider = 'deepseek-account', model = 'deepseek-flash', seq = 1, time = Date.now() } = {}) {
  return sessionEvent('request/header', { header: { config: { provider, model } }, reason: 'initial' }, { seq, time })
}

export function assistantEvent(usage, { seq = 2, turn = 1, step = 1, time = Date.now() } = {}) {
  return sessionEvent(
    'assistant/message',
    { turn, step, message: { role: 'assistant', content: [] }, stream: [], usage },
    { seq, time },
  )
}

/** Fake ServerResponse: captures status, headers and body. */
export function makeRes() {
  const state = { status: 0, headers: {}, body: '' }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? {}
    },
    end(body) {
      state.body = body ?? ''
    },
    json() {
      return JSON.parse(state.body)
    },
  }
}

/** Fake IncomingMessage. Defaults to a loopback same-origin GET. */
export function makeReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/dsh-optimizer/state.json',
    headers: { host: '127.0.0.1:60110' },
    ...overrides,
  }
}

/** Drive one registered route and resolve the captured response. */
export async function callRoute(ctx, routePath, req = makeReq()) {
  const route = ctx.routes.get(routePath)
  if (!route) throw new Error(`route not mounted: ${routePath}`)
  const res = makeRes()
  await route.handler(req, res)
  // Some handlers respond asynchronously after the returned promise settles.
  for (let i = 0; i < 5 && res.state.body === '' && !res.state.status; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return res
}
