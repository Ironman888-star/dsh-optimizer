/**
 * Host composition.
 *
 * Boot order matters: config → paths → logger → analytics modules → routes.
 * Every module mount is isolated: a missing service or a throwing `attach` must
 * degrade that one feature, never the Host. The plugin also has to survive a
 * DSH restart with `enabled: false` — in that state status/config routes plus the independent
 * task-instruction section and context packing remain independent of analytics mode.
 */
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { resolveStateRoot, ensureLayout, dayKey } from './paths.js'
import { readJson } from './store.js'
import { createLogger } from './logger.js'
import { createConfigStore, DEFAULT_CONFIG } from './config.js'
import { createLedger } from './ledger.js'
import { createAnomaly } from './anomaly.js'
import { createBudget } from './budget.js'
import { createToolResult } from './toolresult.js'
import { createPromptAudit } from './prompt.js'
import { createContextBudget, planBudget } from './context.js'
import { createCheckpoint } from './checkpoint.js'
import { createServer } from './server.js'
import { createTaskInstructions } from './task-instructions.js'
import { createContextPacking } from './context-packing.js'
import { writeReport, buildReport } from './report.js'
import * as pricing from './pricing.js'

export const PLUGIN_ID = 'dsh-optimizer'
export const VERSION = '0.3.6'

export function createHost(options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : null
  const now = () => (clock ? new Date(clock()) : new Date())
  const root = options.root ?? null

  // Tests (and isolated workspaces) can point the plugin at a private DSH home.
  if (typeof options.home === 'string' && options.home.trim() !== '') {
    process.env.DSH_HOME = options.home
  }

  const defaultRoot = resolveStateRoot('')
  const bootConfig = readJson(path.join(defaultRoot, 'config.json'), {})
  const stateRoot = resolveStateRoot(bootConfig?.stateDir ?? '')
  ensureLayout(stateRoot)
  if (stateRoot !== defaultRoot) ensureLayout(defaultRoot)

  const log = createLogger({ file: path.join(stateRoot, 'logs', 'optimizer.log'), level: 'info' })
  const config = createConfigStore({ file: path.join(defaultRoot, 'config.json'), log })
  const paths = { root: stateRoot }
  const core = { root, paths, log, config, now, pricing, version: VERSION }

  // Wire each module into `core` as soon as it exists: later modules take the
  // earlier ones as dependencies (budget reads the ledger aggregates, anomaly is
  // the shared alert sink), so a single trailing Object.assign would hand every
  // module `undefined` for its dependencies.
  const ledger = createLedger(core)
  core.ledger = ledger
  const anomaly = createAnomaly(core)
  core.anomaly = anomaly
  const budget = createBudget(core)
  core.budget = budget
  const toolresult = createToolResult(core)
  core.toolresult = toolresult
  const prompt = createPromptAudit(core)
  core.prompt = prompt
  const context = createContextBudget(core)
  core.context = context
  const checkpoint = createCheckpoint(core)
  core.checkpoint = checkpoint

  const taskInstructions = createTaskInstructions(core)
  core.taskInstructions = taskInstructions
  const contextPacking = createContextPacking(core)
  core.contextPacking = contextPacking

  const startedAt = now()
  const mounts = []
  const moduleStatus = new Map()
  const paused = { value: false }

  const host = {
    id: PLUGIN_ID,
    version: VERSION,
    paths,
    core,
    config,
    ledger,
    anomaly,
    budget,
    toolresult,
    prompt,
    context,
    checkpoint,
    taskInstructions,
    contextPacking,
    server: null,
    log,
    now,
    startedAt,
    paused,
    status: () => buildStatus(),
    actions: (name, payload) => runAction(name, payload, false),
    ownerControl: (name, payload) => runAction(name, payload, true),
    report: () => writeReport(host),
    reportSnapshot: () => buildReport(host),
    start,
    dispose,
  }

  // Create the route layer only after `host` exists: handlers dereference the
  // finished host (status/report/config), never the partially built one.
  const server = createServer({ core, host, log })
  host.server = server
  core.server = server

  function setModule(id, state, detail) {
    moduleStatus.set(id, { id, state, detail: detail ? String(detail).slice(0, 300) : undefined, at: now().toISOString() })
  }

  function mount(deps, id, attachFn) {
    const run = (ctx) => {
      let dispose = null
      try {
        dispose = attachFn(ctx)
        setModule(id, 'mounted')
      } catch (error) {
        setModule(id, 'failed', error?.message)
        log.error(`module ${id} attach failed`, error)
        return
      }
      if (typeof ctx?.effect === 'function') {
        try {
          ctx.effect(() => () => {
            try { dispose?.() } catch (error) { log.warn(`module ${id} dispose failed`, error) }
          }, `${PLUGIN_ID}:${id}`)
        } catch { /* effect unsupported in test doubles */ }
      }
      mounts.push({ id, dispose })
    }

    try {
      if (root && typeof root.inject === 'function') {
        setModule(id, 'waiting', deps.join(','))
        root.inject(deps, (ctx) => run(ctx))
      } else {
        run(root ?? {})
      }
    } catch (error) {
      setModule(id, 'failed', error?.message)
      log.error(`module ${id} inject failed`, error)
    }
  }

  function start() {
    const enabled = config.get('enabled')
    log.info(`boot v${VERSION} state=${stateRoot} enabled=${enabled} mode=${config.get('mode')}`)

    // Config/status routes are always mounted so a disabled plugin can be
    // re-enabled from the UI or by editing config.json.
    mount(['webServer'], 'server', (ctx) => server.attach(ctx))
    mount([], 'budget', () => budget.attach())
    // Task guidance and history packing are independent of analytics mode.
    mount(['systemPrompt'], 'taskInstructions', (ctx) => taskInstructions.attach(ctx))
    mount(['agents'], 'contextPacking', (ctx) => contextPacking.attach(ctx))

    if (!enabled) {
      log.info('analytics disabled: status/config routes and independent guidance/packing remain active')
      return
    }

    mount(['sessions'], 'ledger', (ctx) => ledger.attach(ctx))
    mount(['sessions'], 'anomaly', (ctx) => anomaly.attach(ctx))
    mount(['tools'], 'toolResult', (ctx) => toolresult.attach(ctx))
    mount(['systemPrompt'], 'prompt', (ctx) => prompt.attach(ctx))
    mount(['sessions', 'timer'], 'checkpoint', (ctx) => checkpoint.attach(ctx))
    mount(['sessions'], 'context', (ctx) => context.attach(ctx))

    mount(['timer'], 'housekeeping', (ctx) => {
      const disposers = []
      disposers.push(ctx.timer.interval(() => {
        try { ledger.flush() } catch (error) { log.warn('ledger flush failed', error) }
      }, 30_000))
      disposers.push(ctx.timer.interval(() => {
        try { prune() } catch (error) { log.warn('retention failed', error) }
      }, 30 * 60_000))
      return () => { for (const dispose of disposers) { try { dispose?.() } catch { /* ignore */ } } }
    })

    // One deferred retention pass per boot, after the app settles.
    try {
      const handle = setTimeout(() => { try { prune() } catch { /* ignore */ } }, 90_000)
      handle.unref?.()
    } catch { /* ignore */ }
  }

  function prune() {
    const retention = config.get('retention')
    const dirs = [
      ['ledger', retention.ledgerDays],
      ['spill', retention.spillDays],
      ['checkpoints', retention.checkpointDays],
      ['logs', retention.logDays],
    ]
    for (const [sub, days] of dirs) {
      const dir = path.join(stateRoot, sub)
      const cutoff = now().getTime() - Math.max(1, days) * 86_400_000
      let entries = []
      try { entries = fs.readdirSync(dir) } catch { continue }
      for (const name of entries) {
        const file = path.join(dir, name)
        try {
          const stat = fs.statSync(file)
          const daily = /^\d{4}-\d{2}-\d{2}\./.test(name)
          if (daily) {
            const day = name.slice(0, 10)
            if (Date.parse(`${day}T00:00:00Z`) < cutoff) fs.unlinkSync(file)
          } else if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(file)
          }
        } catch { /* ignore */ }
      }
    }
  }

  function buildStatus() {
    const uptimeMs = now().getTime() - startedAt.getTime()
    return {
      plugin: {
        id: PLUGIN_ID,
        version: VERSION,
        enabled: config.get('enabled'),
        mode: config.get('mode'),
        paused: paused.value || budget.gate().paused,
        pauseReason: budget.gate().reason,
        startedAt: startedAt.toISOString(),
        uptimeMs,
        stateRoot,
        defaultStateRoot: defaultRoot,
        dshHome: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
        node: process.version,
        pid: process.pid,
        today: dayKey(now()),
        pricingVersion: pricing.PRICING_VERSION,
        configFile: config.file,
      },
      config: config.snapshot(),
      ledger: ledger.snapshot(),
      budget: budget.status(),
      anomalies: anomaly.snapshot(),
      prompt: prompt.snapshot(),
      context: context.snapshot(),
      checkpoints: checkpoint.snapshot(),
      toolResult: toolresult.stats(),
      taskInstructions: taskInstructions.snapshot(),
      contextPacking: contextPacking.snapshot(),
      modules: [...moduleStatus.values()],
    }
  }

  function runAction(name, payload = {}, fromVerifiedUiRoute = false) {
    if (name === 'setPackingConfig' || name === 'setTaskInstructions') {
      if (!fromVerifiedUiRoute) return { ok: false, errors: ['此操作必须经过设置页面的专用控制接口'] }
    }
    switch (name) {
      case 'pause':
        paused.value = true
        budget.pause(payload.reason ?? '手动暂停')
        return { ok: true, status: { paused: true, reason: budget.gate().reason } }
      case 'resume':
        paused.value = false
        budget.resume()
        return { ok: true, status: { paused: false } }
      case 'setMode': {
        const mode = payload.mode === 'enforce' ? 'enforce' : 'audit'
        const result = config.set('mode', mode)
        return { ok: result.ok, mode, errors: result.errors }
      }
      case 'setEnabled': {
        const enabled = Boolean(payload.enabled)
        const result = config.set('enabled', enabled)
        return { ok: result.ok, enabled, errors: result.errors, note: '重启 DSH 后完全生效；关闭后仅保留状态路由' }
      }
      case 'setConfig': {
        if (String(payload.path ?? '') === 'contextPacking' || String(payload.path ?? '').startsWith('contextPacking.')) {
          return { ok: false, errors: ['上下文打包设置只能通过设置页的专用控制接口修改'] }
        }
        if (String(payload.path ?? '') === 'taskInstructions' || String(payload.path ?? '').startsWith('taskInstructions.')) {
          return { ok: false, errors: ['任务指令只能通过设置页专用接口修改'] }
        }
        if (!payload.path || typeof payload.path !== 'string') return { ok: false, errors: ['path 必填'] }
        const result = config.set(payload.path, payload.value)
        return { ok: result.ok, errors: result.errors, config: config.snapshot() }
      }
      case 'setPackingConfig':
        return contextPacking.change(payload)
      case 'setTaskInstructions':
        return taskInstructions.change(payload)
      case 'flush':
        ledger.flush(true)
        return { ok: true }
      case 'prune':
        prune()
        return { ok: true }
      case 'report': {
        const result = writeReport(host)
        return { ok: true, files: result.files }
      }
      case 'checkpointPlan':
        return { ok: true, plan: checkpoint.plan({ taskId: payload.taskId, sessionId: payload.sessionId }) }
      case 'planBudget':
        return { ok: true, plan: planBudget(payload) }
      default:
        return { ok: false, errors: [`未知操作 ${name}`] }
    }
  }

  function dispose() {
    for (const mount of mounts.reverse()) {
      try { mount.dispose?.() } catch (error) { log.warn(`dispose ${mount.id} failed`, error) }
    }
    try { ledger.flush(true) } catch { /* ignore */ }
    try { toolresult.dispose?.() } catch { /* ignore */ }
    try { prompt.dispose?.() } catch { /* ignore */ }
    try { context.dispose?.() } catch { /* ignore */ }
    log.info('disposed')
  }

  return host
}

export { DEFAULT_CONFIG }
