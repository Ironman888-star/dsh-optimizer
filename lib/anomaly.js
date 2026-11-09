/**
 * Anomaly detection.
 *
 * Detectors are deliberately simple, session-scoped and deterministic so the
 * same event stream always yields the same alerts (tests depend on it):
 *
 *  - repeat-failure   same tool failing N times in a row
 *  - tool-loop        identical (tool, arguments) calls repeated N times
 *  - repeated-read    identical read/glob/grep target repeated N times
 *  - cache-hit-drop   recent cache-hit rate collapses against the session baseline
 *  - request-burst    request headers per minute exceed the configured rate
 *  - context-pressure context tokens exceed the budget ratio
 *  - budget           spending crosses a warn/limit threshold (reported by budget.js)
 *
 * Alerts are appended to `anomalies.jsonl` and kept in a bounded ring for the
 * UI. Cooldowns keep one misbehaving loop from flooding the ledger.
 */
import fs from 'node:fs'
import path from 'node:path'
import { appendJsonl, listFiles } from './store.js'
import { dayKey } from './paths.js'
import { normalizeUsage } from './pricing.js'

const READ_TOOLS = new Set(['read', 'read_text', 'glob', 'grep', 'list_dir', 'listDir'])
const RING = 120

function stableHash(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function argsKey(argumentsValue) {
  try {
    return stableHash(JSON.stringify(argumentsValue ?? null))
  } catch {
    return 'unhashable'
  }
}

function sessionIdOf(session) {
  if (!session) return 'unknown'
  return typeof session.id === 'string' && session.id ? session.id : 'unknown'
}

export function createAnomaly(core) {
  const { paths, log, config, now } = core
  const file = path.join(paths.root, 'anomalies.jsonl')
  const ring = []
  const cooldown = new Map()
  const sessions = new Map()
  let seq = 0
  let loaded = false

  function sessionState(id) {
    if (!sessions.has(id)) {
      sessions.set(id, {
        failures: new Map(),
        calls: new Map(),
        reads: new Map(),
        headers: [],
        hits: [],
        lastAlert: new Map(),
        lastSeq: 0,
      })
    }
    return sessions.get(id)
  }

  function load() {
    if (loaded) return
    loaded = true
    const files = listFiles(path.join(paths.root, 'ledger'), (name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()
    const today = files.at(-1)
    if (!today) return
    try {
      const text = fs.readFileSync(today, 'utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line)
          if (record && record.kind) ring.push(record)
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
    if (ring.length > RING) ring.splice(0, ring.length - RING)
  }

  const cfg = () => config.get('anomaly')

  function withinWindow(state, key, ms) {
    const list = state.calls.get(key) ?? state.reads.get(key) ?? []
    const cutoff = now().getTime() - ms
    return list.filter((time) => time >= cutoff)
  }

  function alert(kind, input) {
    const settings = cfg()
    if (!settings.enabled) return null
    const sessionId = input.sessionId ?? 'unknown'
    const key = `${sessionId}:${kind}:${input.key ?? ''}`
    const last = cooldown.get(key)
    const stamp = now().getTime()
    if (last && stamp - last < settings.alertCooldownMs) return null
    cooldown.set(key, stamp)
    seq += 1
    const record = {
      v: 1,
      id: `an_${dayKey(now()).replace(/-/g, '')}_${seq}`,
      ts: now().toISOString(),
      sessionId,
      kind,
      severity: input.severity ?? 'warn',
      message: input.message ?? kind,
      data: input.data ?? {},
    }
    ring.push(record)
    if (ring.length > RING) ring.shift()
    try { appendJsonl(file, [record]) } catch (error) { log?.error('anomaly append failed', error) }
    core.ledger?.note('anomalies')
    return record
  }

  function onEvent(session, event) {
    const sessionId = sessionIdOf(session)
    const state = sessionState(sessionId)
    const settings = cfg()
    if (!settings.enabled) return
    const data = event?.data ?? {}
    const at = Number(event?.time ?? now().getTime())

    switch (event?.type) {
      case 'tool/result': {
        const failed = Boolean(data.error)
        const name = data.message?.toolName ?? data.name ?? 'tool'
        if (failed) {
          const count = (state.failures.get(name) ?? 0) + 1
          state.failures.set(name, count)
          if (count >= settings.failureRepeatThreshold) {
            alert('repeat-failure', {
              sessionId,
              key: name,
              message: `工具 ${name} 连续失败 ${count} 次`,
              data: { tool: name, count, code: data.error?.code ?? null },
            })
          }
        } else {
          state.failures.set(name, 0)
        }
        break
      }
      case 'tool/call': {
        const name = String(data.name ?? 'tool')
        const key = `${name}:${argsKey(data.arguments)}`
        const list = state.calls.get(key) ?? []
        list.push(at)
        state.calls.set(key, list.slice(-32))
        const repeats = withinWindow(state, key, settings.windowMs).length
        if (repeats >= settings.toolLoopRepeatThreshold) {
          alert('tool-loop', {
            sessionId,
            key,
            severity: 'warn',
            message: `疑似无效工具循环：${name} 以相同参数调用 ${repeats} 次`,
            data: { tool: name, repeats },
          })
        }
        if (READ_TOOLS.has(name)) {
          const readList = (state.reads.get(key) ?? []).concat(at)
          state.reads.set(key, readList.slice(-32))
          const readRepeats = withinWindow(state, key, settings.windowMs).length
          if (readRepeats >= settings.readRepeatThreshold) {
            alert('repeated-read', {
              sessionId,
              key,
              severity: 'info',
              message: `重复读取同一目标 ${readRepeats} 次：${name}`,
              data: { tool: name, repeats: readRepeats },
            })
          }
        }
        break
      }
      case 'request/header': {
        state.headers.push(at)
        state.headers = state.headers.filter((time) => time >= at - 60_000)
        if (state.headers.length > settings.requestsPerMinute) {
          alert('request-burst', {
            sessionId,
            key: 'rpm',
            message: `请求速率异常：每分钟 ${state.headers.length} 次`,
            data: { requestsPerMinute: state.headers.length },
          })
        }
        break
      }
      case 'assistant/message': {
        const usage = data.usage
        if (!usage) break
        // Reuse the ledger's normalization so "hit rate" means the same thing
        // everywhere (total-input vs uncached-input providers differ).
        const tokens = normalizeUsage(usage)
        if (tokens.totalInput <= 0) break
        state.hits.push(tokens.cacheHitRate)
        if (state.hits.length > 200) state.hits.shift()
        if (state.hits.length >= 10) {
          const baseline = state.hits.slice(0, -5).reduce((a, b) => a + b, 0) / Math.max(1, state.hits.slice(0, -5).length)
          const recent = state.hits.slice(-5).reduce((a, b) => a + b, 0) / 5
          if (baseline > 0.5 && recent < baseline * (1 - settings.cacheHitDropRatio)) {
            alert('cache-hit-drop', {
              sessionId,
              key: 'hit',
              severity: 'warn',
              message: `缓存命中率下降：${(baseline * 100).toFixed(1)}% → ${(recent * 100).toFixed(1)}%`,
              data: { baseline: Number(baseline.toFixed(4)), recent: Number(recent.toFixed(4)) },
            })
          }
        }
        break
      }
      default:
        break
    }
  }

  function attach(ctx) {
    load()
    const dispose = ctx.on('session/event', (session, event) => {
      try { onEvent(session, event) } catch (error) { log?.error('anomaly event failed', error) }
    })
    return () => { try { dispose?.() } catch { /* ignore */ } }
  }

  return {
    attach,
    alert,
    onEvent,
    recent: (limit = 20) => ring.slice(-limit).reverse(),
    counts: () => {
      const out = {}
      for (const record of ring) out[record.kind] = (out[record.kind] ?? 0) + 1
      return out
    },
    snapshot: () => ({ recent: ring.slice(-20).reverse(), counts: (() => {
      const out = {}
      for (const record of ring) out[record.kind] = (out[record.kind] ?? 0) + 1
      return out
    })() }),
  }
}
