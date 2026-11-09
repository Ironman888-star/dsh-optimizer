/**
 * Context budgeting.
 *
 * Two jobs:
 *
 *  1. Measure pressure. `tokenMeter.contextPressure(session)` already knows the
 *     session's real size and window, so the optimizer polls it on a throttle
 *     and raises an alert before a turn is silently truncated.
 *
 *  2. Answer "how much room does this kind of task get?" The Host owns assembly
 *     (we must not fork it), but a shared budget plan is what the Lead/workers
 *     and the UI actually need: per-layer targets for L0 core rules, L1 task
 *     context, L2 retrieved material and L3 archive, plus the output reserve.
 *
 * The plan is advisory: it never truncates a message by itself.
 */
import path from 'node:path'
import { readJson, writeJson } from './store.js'

const TOKENS_PER_CHAR = 1 / 3.6

export const TASK_PROFILES = {
  simple: { key: 'simple', label: '单文件修复/小改动', contextTokens: 24_000, outputReserve: 4_000, layers: { l0: 3_000, l1: 12_000, l2: 6_000, l3: 0 } },
  standard: { key: 'standard', label: '普通开发任务', contextTokens: 32_000, outputReserve: 6_000, layers: { l0: 3_500, l1: 18_000, l2: 8_000, l3: 0 } },
  crossModule: { key: 'crossModule', label: '跨模块开发', contextTokens: 64_000, outputReserve: 8_000, layers: { l0: 4_000, l1: 38_000, l2: 16_000, l3: 0 } },
  research: { key: 'research', label: '调研/审计', contextTokens: 48_000, outputReserve: 6_000, layers: { l0: 3_000, l1: 20_000, l2: 22_000, l3: 0 } },
}

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length * TOKENS_PER_CHAR)
}

/** Allocate a token budget for one task; layers always sum to contextTokens. */
export function planBudget({ taskType = 'standard', contextTokens, outputReserve, toolCount = 0 } = {}) {
  const profile = TASK_PROFILES[taskType] ?? TASK_PROFILES.standard
  const total = Math.max(4_000, Number(contextTokens ?? profile.contextTokens))
  const reserve = Math.max(500, Number(outputReserve ?? profile.outputReserve))
  const toolOverhead = Math.min(Math.round(total * 0.15), Math.max(0, Number(toolCount) || 0) * 220)
  const base = profile.layers
  const baseSum = base.l0 + base.l1 + base.l2
  const scale = (total - toolOverhead) / baseSum
  const layers = {
    l0: Math.round(base.l0 * scale),
    l1: Math.round(base.l1 * scale),
    l2: Math.round(base.l2 * scale),
    tools: toolOverhead,
    l3: 'on-demand only',
  }
  return {
    taskType: profile.key,
    label: profile.label,
    contextTokens: total,
    outputReserve: reserve,
    layers,
    archivePolicy: 'L3（旧聊天全文、大型日志、已完成任务细节）默认不入上下文，需要时用本地搜索按需读取',
    notes: [
      'L0 与 L1 优先保障，不得为省 token 裁剪当前任务约束或未完成的工具调用',
      'L2 按相关性选择，超出预算时保留最近的决策与测试证据',
      '连续重复的相同工具结果只保留一份，其余保留文件路径',
    ],
  }
}

function sessionIdOf(session) {
  if (!session) return 'unknown'
  return typeof session.id === 'string' && session.id ? session.id : 'unknown'
}

export function createContextBudget(core) {
  const { paths, log, config, anomaly, ledger, now } = core
  const stateFile = path.join(paths.root, 'state', 'context.json')
  const state = readJson(stateFile, { sessions: {}, events: 0 })
  if (!state.sessions) state.sessions = {}
  let counter = 0
  /** tokenMeter from a nested `inject` scope; null until the service is ready. */
  let meter = null

  function persist() {
    try { writeJson(stateFile, state) } catch (error) { log?.error('context state write failed', error) }
  }

  function pressure(ctx, session) {
    // `ctx.get()` throws when the service was not injected into this scope, so
    // treat an unavailable tokenMeter as "no measurement" instead of an error.
    let service = meter
    if (!service) {
      try { service = ctx?.get?.('tokenMeter') ?? null } catch { service = null }
    }
    if (!service || typeof service.contextPressure !== 'function') return null
    try {
      const result = service.contextPressure(session)
      if (!result) return null
      const tokens = Number(result.pressureTokens ?? 0)
      const window = Number(result.contextWindow ?? 0)
      const ratio = window > 0 ? tokens / window : 0
      return { tokens, window, ratio }
    } catch (error) {
      log?.debug('contextPressure failed', error)
      return null
    }
  }

  function sample(ctx, session, force = false) {
    const id = sessionIdOf(session)
    counter += 1
    if (!force && counter % 10 !== 0) return null
    const reading = pressure(ctx, session)
    if (!reading) return null
    state.sessions[id] = { ...reading, at: now().toISOString() }
    state.events = counter
    const warnRatio = config.get('context.warnRatio')
    const budget = config.get('context.defaultBudgetTokens')
    if (reading.ratio >= warnRatio || (budget > 0 && reading.tokens >= budget)) {
      ledger?.note('contextPressureEvents')
      anomaly?.alert('context-pressure', {
        sessionId: id,
        key: 'window',
        severity: reading.ratio >= 0.95 ? 'critical' : 'warn',
        message: `上下文压力 ${reading.tokens} tokens（窗口 ${reading.window || '未知'}，${(reading.ratio * 100).toFixed(0)}%）`,
        data: reading,
      })
    }
    if (counter % 200 === 0) persist()
    return reading
  }

  function attach(ctx) {
    // `tokenMeter` is optional: ask for a child scope that injects it so the
    // pressure reading works even though this module mounts on `sessions` only.
    let scope = null
    try {
      if (typeof ctx.inject === 'function') scope = ctx.inject(['tokenMeter'], (scoped) => { meter = scoped.tokenMeter ?? null })
    } catch { meter = null }
    const dispose = ctx.on('session/event', (session, event) => {
      try {
        const type = event?.type
        if (type === 'turn/end' || type === 'step/end' || type === 'user/message') sample(ctx, session, type === 'turn/end')
      } catch (error) {
        log?.error('context sample failed', error)
      }
    })
    return () => {
      try { dispose?.() } catch { /* ignore */ }
      try { scope?.() } catch { /* ignore */ }
      meter = null
      persist()
    }
  }

  return {
    attach,
    sample,
    plan: planBudget,
    estimate: estimateTokens,
    latest: (sessionId) => (sessionId ? state.sessions[sessionId] ?? null : Object.entries(state.sessions).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))[0] ?? null),
    snapshot: () => ({
      plan: planBudget({ taskType: 'standard' }),
      profiles: Object.values(TASK_PROFILES).map((profile) => ({ key: profile.key, label: profile.label, contextTokens: profile.contextTokens, outputReserve: profile.outputReserve })),
      sessions: Object.entries(state.sessions)
        .map(([id, reading]) => ({ sessionId: id, ...reading }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 8),
    }),
    dispose: persist,
  }
}
