/**
 * Token & cost ledger.
 *
 * Source of truth: durable session events. Every model call surfaces as
 * `assistant/message` carrying `usage: TokenUsage`, and each request series
 * opens with `request/header` carrying the provider/model. Both arrive on
 * `session/event`, so the ledger needs no LLM wrapper, no extra API call, and
 * survives a restart because the events are already durable in the session log.
 *
 * The ledger also keeps non-token optimization metrics (chars pruned, prompt
 * bytes removed, checkpoints, anomalies) so reports can separate "we spent less"
 * from "we deleted things".
 */
import path from 'node:path'
import { appendJsonl, readJson, writeJson } from './store.js'
import { dayKey, ledgerFile } from './paths.js'
import { estimateRequest, normalizeUsage } from './pricing.js'

const EMPTY_TOTALS = () => ({
  requests: 0,
  billedRequests: 0,
  inputTokens: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUSD: 0,
})

const EMPTY_METRICS = () => ({
  toolCharsPruned: 0,
  toolResultsPruned: 0,
  toolResultsDeduped: 0,
  promptCharsRemoved: 0,
  promptSectionsTrimmed: 0,
  checkpoints: 0,
  recoveryChecks: 0,
  anomalies: 0,
  budgetWarnings: 0,
  contextPressureEvents: 0,
  subagentsSpawned: 0,
  tasksDeduped: 0,
})

const TRACK_FIELDS = ['requests', 'billedRequests', 'inputTokens', 'uncachedInputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens', 'costUSD']

function bump(target, totals) {
  for (const field of TRACK_FIELDS) target[field] += totals[field] ?? 0
  return target
}

function hitRate(totals) {
  if (!totals || !totals.inputTokens) return 0
  return totals.cachedInputTokens / totals.inputTokens
}

function sessionIdOf(session) {
  if (!session) return 'unknown'
  if (typeof session.id === 'string' && session.id) return session.id
  if (typeof session.sessionId === 'string' && session.sessionId) return session.sessionId
  return 'unknown'
}

export function createLedger(core) {
  const { paths, log, config, now } = core
  const stateFile = path.join(paths.root, 'state', 'ledger.json')
  const saved = readJson(stateFile, null)

  const state = {
    version: 1,
    updatedAt: now().toISOString(),
    project: EMPTY_TOTALS(),
    days: {},
    sessions: {},
    agents: {},
    tasks: {},
    byModel: {},
    metrics: {},
    recent: [],
    attributes: {},
    models: {},
    dirty: 0,
  }

  if (saved && saved.version === 1) {
    Object.assign(state, {
      project: { ...EMPTY_TOTALS(), ...(saved.project ?? {}) },
      days: saved.days ?? {},
      sessions: saved.sessions ?? {},
      agents: saved.agents ?? {},
      tasks: saved.tasks ?? {},
      byModel: saved.byModel ?? {},
      metrics: saved.metrics ?? {},
      recent: Array.isArray(saved.recent) ? saved.recent.slice(-300) : [],
      attributes: saved.attributes ?? {},
      models: saved.models ?? {},
    })
  }

  const listeners = new Set()
  const defaultModel = { provider: 'deepseek-account', model: 'deepseek-flash' }

  function emit(record) {
    for (const listener of listeners) {
      try { listener(record) } catch (error) { log?.warn('ledger listener failed', error) }
    }
  }

  function sessionBucket(id) {
    if (!state.sessions[id]) {
      state.sessions[id] = { ...EMPTY_TOTALS(), firstSeen: now().toISOString(), lastSeen: null, title: '', agentId: id, taskId: null }
    }
    return state.sessions[id]
  }

  function metricsFor(day) {
    if (!state.metrics[day]) state.metrics[day] = EMPTY_METRICS()
    return state.metrics[day]
  }

  function flush(force = false) {
    if (!force && state.dirty < 5) return
    state.dirty = 0
    state.updatedAt = now().toISOString()
    try {
      writeJson(stateFile, {
        version: state.version,
        updatedAt: state.updatedAt,
        project: state.project,
        days: state.days,
        sessions: state.sessions,
        agents: state.agents,
        tasks: state.tasks,
        byModel: state.byModel,
        metrics: state.metrics,
        recent: state.recent.slice(-300),
        attributes: state.attributes,
        models: state.models,
      })
    } catch (error) {
      log?.error('ledger flush failed', error)
    }
  }

  function prune() {
    const keepDays = config.get('retention.ledgerDays')
    const limit = dayKey(new Date(now().getTime() - keepDays * 86_400_000))
    for (const day of Object.keys(state.days)) if (day < limit) delete state.days[day]
    for (const day of Object.keys(state.metrics)) if (day < limit) delete state.metrics[day]
    const sessions = Object.entries(state.sessions)
    if (sessions.length > 120) {
      sessions.sort((a, b) => String(a[1].lastSeen ?? '').localeCompare(String(b[1].lastSeen ?? '')))
      for (const [id] of sessions.slice(0, sessions.length - 120)) delete state.sessions[id]
    }
  }

  /** Record one billed model call. */
  function record(input) {
    const {
      sessionId = 'unknown',
      provider,
      model,
      usage,
      turn,
      step,
      seq,
      at = now(),
      requestId,
    } = input
    if (!usage) return null
    const tokens = normalizeUsage(usage)
    if (tokens.totalInput === 0 && tokens.outputTokens === 0) return null

    const chosenProvider = provider || defaultModel.provider
    const chosenModel = model || defaultModel.model
    const { price, costUSD } = estimateRequest({ provider: chosenProvider, model: chosenModel, usage, at })
    const day = dayKey(at)
    const record = {
      v: 1,
      ts: at.toISOString(),
      day,
      sessionId,
      agentId: state.attributes[sessionId]?.agentId ?? sessionId,
      taskId: state.attributes[sessionId]?.taskId ?? null,
      turn: turn ?? null,
      step: step ?? null,
      seq: seq ?? null,
      requestId: requestId ?? null,
      provider: chosenProvider,
      model: chosenModel,
      pricingId: price.pricingId,
      priceVersion: price.pricingVersion,
      tier: price.tier,
      inputTokens: tokens.totalInput,
      uncachedInputTokens: tokens.uncachedInputTokens,
      cachedInputTokens: tokens.cachedInputTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      outputTokens: tokens.outputTokens,
      reasoningTokens: tokens.reasoningTokens,
      inputMode: tokens.mode,
      costUSD,
    }

    // aggregate
    if (!state.days[day]) state.days[day] = EMPTY_TOTALS()
    bump(state.days[day], { ...record, requests: 1, billedRequests: 1 })
    bump(state.project, { ...record, requests: 1, billedRequests: 1 })
    const bucket = sessionBucket(sessionId)
    bump(bucket, { ...record, requests: 1, billedRequests: 1 })
    bucket.lastSeen = record.ts
    bucket.title = input.sessionTitle ?? bucket.title
    const agentId = record.agentId
    if (!state.agents[agentId]) state.agents[agentId] = { ...EMPTY_TOTALS(), firstSeen: record.ts, lastSeen: record.ts }
    bump(state.agents[agentId], { ...record, requests: 1, billedRequests: 1 })
    state.agents[agentId].lastSeen = record.ts
    if (record.taskId) {
      if (!state.tasks[record.taskId]) state.tasks[record.taskId] = { ...EMPTY_TOTALS(), firstSeen: record.ts, lastSeen: record.ts }
      bump(state.tasks[record.taskId], { ...record, requests: 1, billedRequests: 1 })
      state.tasks[record.taskId].lastSeen = record.ts
    }
    const modelKey = `${record.provider}/${record.model}`
    if (!state.byModel[modelKey]) state.byModel[modelKey] = { ...EMPTY_TOTALS() }
    bump(state.byModel[modelKey], { ...record, requests: 1, billedRequests: 1 })
    state.recent.push(record)
    if (state.recent.length > 300) state.recent.splice(0, state.recent.length - 300)
    state.dirty += 1

    try {
      appendJsonl(ledgerFile(paths.root, day), [record])
    } catch (error) {
      log?.error('ledger append failed', error)
    }
    if (state.dirty >= 5) flush()
    emit(record)
    return record
  }

  /** Count a request attempt even if it produced no usage (error / interrupt). */
  function countAttempt(input = {}) {
    const at = input.at ?? now()
    const day = dayKey(at)
    if (!state.days[day]) state.days[day] = EMPTY_TOTALS()
    state.days[day].requests += 1
    state.project.requests += 1
    const id = input.sessionId ?? 'unknown'
    const bucket = sessionBucket(id)
    bucket.requests += 1
    state.dirty += 1
  }

  function attribute(sessionId, patch) {
    const current = state.attributes[sessionId] ?? {}
    state.attributes[sessionId] = { ...current, ...patch }
    state.dirty += 1
    return state.attributes[sessionId]
  }

  function note(kind, value = 1, at = now()) {
    const metrics = metricsFor(dayKey(at))
    if (!(kind in metrics)) return
    metrics[kind] += value
    state.dirty += 1
  }

  function snapshot(input = {}) {
    const day = dayKey(input.at ?? now())
    const seriesDays = input.seriesDays ?? 14
    const series = []
    for (let i = seriesDays - 1; i >= 0; i -= 1) {
      const key = dayKey(new Date(now().getTime() - i * 86_400_000))
      const totals = state.days[key] ?? EMPTY_TOTALS()
      series.push({ day: key, ...totals, cacheHitRate: hitRate(totals) })
    }
    const sessionsTop = Object.entries(state.sessions)
      .map(([id, totals]) => ({ sessionId: id, ...totals, cacheHitRate: hitRate(totals) }))
      .sort((a, b) => b.costUSD - a.costUSD)
      .slice(0, 8)
    return {
      today: { ...(state.days[day] ?? EMPTY_TOTALS()), cacheHitRate: hitRate(state.days[day]) },
      project: { ...state.project, cacheHitRate: hitRate(state.project) },
      series,
      sessionsTop,
      recent: state.recent.slice(-20).reverse(),
      byModel: state.byModel,
      metrics: { today: { ...EMPTY_METRICS(), ...(state.metrics[day] ?? {}) } },
      pricingVersion: core.pricing.PRICING_VERSION ?? null,
    }
  }

  function attach(ctx) {
    const disposers = []
    const headers = new Map()
    disposers.push(ctx.on('session/event', (session, event) => {
      try {
        onEvent(session, event, headers)
      } catch (error) {
        log?.error('ledger event failed', error)
      }
    }))
    function onEvent(session, event, headerMap) {
      const sessionId = sessionIdOf(session)
      const data = event?.data ?? {}
      switch (event?.type) {
        case 'request/header': {
          const config = data.header?.config ?? data.header ?? {}
          const model = config.model ?? config.modelId ?? null
          const provider = config.provider ?? config.providerId ?? null
          if (model) headerMap.set(sessionId, { provider, model })
          countAttempt({ sessionId, at: new Date(event.time ?? now().getTime()) })
          break
        }
        case 'assistant/message': {
          if (!data.usage) break
          const header = headerMap.get(sessionId) ?? {}
          record({
            sessionId,
            provider: header.provider ?? data.provider ?? null,
            model: header.model ?? data.model ?? null,
            usage: data.usage,
            turn: data.turn,
            step: data.step,
            seq: event.seq,
            at: new Date(event.time ?? now().getTime()),
          })
          break
        }
        default:
          break
      }
    }
    return () => {
      for (const dispose of disposers) {
        try { dispose?.() } catch { /* ignore */ }
      }
      flush(true)
    }
  }

  function dispose() {
    prune()
    flush(true)
  }

  return {
    state,
    attach,
    dispose,
    flush,
    record,
    countAttempt,
    attribute,
    note,
    snapshot,
    hitRate,
    totalsForTask: (taskId) => state.tasks[taskId] ?? null,
    totalsForAgent: (agentId) => state.agents[agentId] ?? null,
    totalsForSession: (sessionId) => state.sessions[sessionId] ?? null,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    EMPTY_TOTALS,
    EMPTY_METRICS,
  }
}
