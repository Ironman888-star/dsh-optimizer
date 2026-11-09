/**
 * DSH session-surface conversation-history trimming (round count only).
 *
 * Removes safe nodes from old model-visible conversation turns via a sourced
 * surface replacement before request derivation, preserving the append-only
 * event log. No token budgets, estimators, LLM summaries, or request rewriting.
 * Keep the protected system head and effective instructions. Only older prompt
 * snapshots with verified DSH in-history supersession may be shadowed.
 * Developer tool updates, unknown instructions and the live turn stay visible.
 * If a segment cannot be safely trimmed, do NOT reject the conversation.
 */
import { randomUUID } from 'node:crypto'

const MARKER = '[较早会话已按主人设置从模型上下文中移除；原始记录仍保留。]'
const SOURCE_KIND = 'dsh-optimizer-context-packing'
const MAX_RECENT = 12

// DSH supports two accepted source spellings across session format versions.
// Never infer instruction authority from text, role or an untrusted user source.
function systemPromptOrigin(event) {
  if (event?.type !== 'system/message' || event.data?.message?.role !== 'system') return null
  const message = event.data.message
  const source = message.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const keys = Object.keys(source).sort().join(',')
  if (keys === 'kind,plugin' && source.kind === 'plugin'
    && source.plugin === '@deepseek-ai/dsh-system-prompt') return 'dsh-system-prompt'
  if (keys === 'kind' && source.kind === 'system-prompt') return 'dsh-system-prompt'
  return null
}

function renderedPromptChars(event) {
  const content = event?.data?.message?.content
  return Array.isArray(content) && content.length === 1
    && content[0]?.type === 'text' && typeof content[0].text === 'string'
    && content[0].text.length > 0 ? content[0].text.length : 0
}

/**
 * In a DSH in-history route the LAST system-prompt snapshot is effective.
 * Replacements of the protected system head are always left to the host.
 * A missing route record, unknown source, or a different system producer is
 * insufficient evidence to declare an old instruction obsolete.
 */
function obsoleteSystemIndices(indexed, state) {
  const obsolete = new Map()
  if (state.routeMode !== 'in-history') return obsolete
  const systems = indexed.filter(entry => entry.type === 'system/message')
  // An empty or unknown *last* system node is not proof of an effective newer
  // prompt. In particular, never look past a later clearing/dormant node.
  const newest = systems.at(-1)
  if (!newest || !renderedPromptChars(newest.event)
    || systemPromptOrigin(newest.event) !== 'dsh-system-prompt') return obsolete
  const firstSeq = indexed[0]?.seq
  for (const entry of systems) {
    if (entry.index >= newest.index || entry.seq === firstSeq) continue
    if (systemPromptOrigin(entry.event) !== 'dsh-system-prompt' || !renderedPromptChars(entry.event)) continue
    obsolete.set(entry.index, renderedPromptChars(entry.event))
  }
  return obsolete
}

function turnId(value, fallback = null) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

/** Inspect only events committed since the last successful inspection. */
function inspectSession(session, cached) {
  if (typeof session?.snapshotEvents !== 'function' || !Array.isArray(session?.surface?.nodes)
    || typeof session?.append !== 'function' || !Number.isSafeInteger(session.seq)) {
    throw new Error('当前 DSH 宿主未开放可验证的 Session surface / 事件快照 API')
  }
  const state = cached && session.seq >= cached.revision ? cached : {
    revision: 0, turn: null, lastTurn: null, routeMode: null, completed: new Set(), turnBySeq: new Map(), events: new Map(),
  }
  const fresh = session.snapshotEvents(state.revision, session.seq)
  if (!Array.isArray(fresh) || fresh.length !== session.seq - state.revision) {
    throw new Error('会话事件快照不完整，已跳过上下文裁剪')
  }
  for (const event of fresh) {
    if (!event || !Number.isSafeInteger(event.seq)) throw new Error('会话事件不完整')
    if (event.type === 'request/context') state.routeMode = event.data?.systemPromptUpdate ?? null
    if (event.type === 'turn/start') state.turn = turnId(event.data?.turn, state.turn)
    const ownTurn = turnId(event.data?.turn, state.turn ?? state.lastTurn)
    state.turnBySeq.set(event.seq, ownTurn)
    state.events.set(event.seq, event)
    if (event.type === 'turn/end') {
      if (ownTurn !== null) state.completed.add(ownTurn)
      state.lastTurn = ownTurn
      state.turn = null
    } else if (ownTurn !== null) {
      state.lastTurn = ownTurn
    }
  }
  state.revision = session.seq
  return state
}

/**
 * Select removable MODEL-VISIBLE nodes, not entire historical turns.
 *
 * `tool/call` is a log-only event in DSH. Counting all tool/call events in the
 * append-only log against the current surface produces false unpaired chains
 * after compaction. We instead inspect `assistant/message` tool-call blocks and
 * `tool/result` nodes that are still present on the surface, keeping every
 * surviving tool-call/result pair together. Ambiguous nodes are pinned, never
 * used to pin their entire turn. Instructions and live/new turns are pinned.
 */
export function selectHistoryPrefix(session, policy, state) {
  const nodes = session.surface.nodes
  const empty = { range: null, ranges: [], protectedTurns: 0, protectedNodes: 0,
    keptHistoricalTurns: 0, removedHistoricalTurns: 0, trimmedHistoricalTurns: 0,
    obsoleteSystemNodes: 0, obsoleteSystemChars: 0, protectedInstructionNodes: 0 }
  if (!nodes.length) return { ...empty, reason: 'empty' }
  const indexed = nodes.map((seq, index) => {
    const event = state.events.get(seq) ?? session.eventAt?.(seq)
    if (!event) throw new Error(`缺少 surface 节点 ${seq}`)
    const marker = event.type === 'user/message' && event.data?.source?.kind === SOURCE_KIND
    return { seq, index, event, type: event.type, marker,
      turn: marker ? null : (state.turnBySeq.get(seq) ?? null) }
  })

  const groups = []
  const byTurn = new Map()
  for (const entry of indexed) {
    if (entry.marker || entry.turn === null || !state.completed.has(entry.turn)) continue
    let group = byTurn.get(entry.turn)
    if (!group) {
      group = { turn: entry.turn, retained: 0, trimmed: 0 }
      byTurn.set(entry.turn, group)
      groups.push(group)
    }
  }
  if (!groups.length) return { ...empty, reason: 'no-closed-turns' }

  const keepCount = Math.max(1, Math.min(20, policy.maxHistoryTurns))
  const discardGroups = groups.slice(0, Math.max(0, groups.length - keepCount))
  const keptHistoricalTurns = Math.min(keepCount, groups.length)
  if (!discardGroups.length) return { ...empty, keptHistoricalTurns, reason: 'within-limits' }
  const oldTurns = new Set(discardGroups.map(group => group.turn))
  const obsoleteSystems = obsoleteSystemIndices(indexed, state)

  // Only known model-visible messages may be deleted. Protect instructions,
  // unknown message types, and non-user injected runtime/context messages.
  // The known compact-checkpoint user message is ordinary old history after a
  // newer turn has superseded it; do not special-case it as pinned.
  const targets = indexed.map(entry => {
    if (entry.marker || !oldTurns.has(entry.turn)) return false
    if (entry.type === 'system/message') return obsoleteSystems.has(entry.index)
    // Developer messages can mutate the tool registry and cannot be considered
    // superseded without a first-class DSH lifecycle proof. Keep them intact.
    if (entry.type === 'developer/message') return false
    if (entry.type === 'assistant/message') {
      const content = entry.event.data?.message?.content
      if (!Array.isArray(content)) return false
      // Tool registry edits must not be discarded by a history-only policy.
      if (content.some(block => block?.type === 'tool-addition' || block?.type === 'tool-removal')) return false
      return true
    }
    if (entry.type === 'tool/result') return true
    if (entry.type === 'user/message') {
      const source = entry.event.data?.source?.kind
      return source === 'user' || source === 'compact-checkpoint' || source === 'dsh-compaction-basic'
        || source === 'compaction' // only known historical summarizers
    }
    return false
  })

  // Tool pairing is derived from visible assistant tool-call CONTENT blocks, not
  // tool/call log events (which may be hidden by compaction). For ambiguous or
  // incomplete visible chains, pin only the relevant nodes. Matched pairs are
  // removable together only when no protected node lies between them.
  const tools = new Map()
  function addTool(id, which, index) {
    if (typeof id !== 'string' || !id) { targets[index] = false; return }
    let record = tools.get(id)
    if (!record) { record = { calls: [], results: [] }; tools.set(id, record) }
    record[which].push(index)
  }
  for (const entry of indexed) {
    const event = entry.event
    if (entry.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'tool-call') addTool(block.id, 'calls', entry.index)
      }
    } else if (entry.type === 'tool/result') {
      // DSH ToolResultMessage has `toolCallId`, not the `callId` field of
      // the log-only tool/call event. Legacy sources may carry source.callId.
      addTool(event.data?.message?.toolCallId ?? event.data?.message?.source?.callId,
        'results', entry.index)
    }
  }
  // Pinned pairs can split other nested/interleaved pairs. Iterate until
  // stable so no accepted range cuts across a surviving tool call boundary.
  let changed
  do {
    changed = false
    for (const item of tools.values()) {
      const positions = [...item.calls, ...item.results]
      let safe = item.calls.length === 1 && item.results.length === 1
      if (safe) {
        const a = item.calls[0], b = item.results[0]
        // A pair cannot cross an instruction, a kept turn, or a pinned node.
        safe = a < b && targets.slice(a, b + 1).every(Boolean)
      }
      if (!safe) {
        // Never insert a pruning marker inside a surviving call/result pair.
        // This protects the whole pair interval, NOT the entire conversation
        // turn (which may contain large independent text before or after it).
        const min = Math.min(...positions), max = Math.max(...positions)
        for (let i = min; i <= max; i++) {
          if (targets[i]) { targets[i] = false; changed = true }
        }
      }
    }
  } while (changed)

  const ranges = []
  // Coalesce generated marker nodes with adjacent old history, never across a
  // pinned instruction or an unresolved tool boundary.
  for (let i = 0; i < indexed.length;) {
    if (!targets[i] && !indexed[i].marker) { i++; continue }
    let j = i
    let includesHistory = false
    let removedMessageNodes = 0
    while (j < indexed.length && (targets[j] || indexed[j].marker)) {
      if (targets[j]) { includesHistory = true; removedMessageNodes++ }
      j++
    }
    if (includesHistory) {
      const slice = indexed.slice(i, j)
      ranges.push({
        startSeq: slice[0].seq, endSeq: slice.at(-1).seq,
        sourceEventSeqs: slice.map(entry => entry.seq), removedMessageNodes,
      })
    }
    i = j
  }

  let protectedNodes = 0
  let protectedInstructionNodes = 0
  let obsoleteSystemNodes = 0
  let obsoleteSystemChars = 0
  for (const entry of indexed) {
    const group = byTurn.get(entry.turn)
    if (!group || !oldTurns.has(entry.turn) || entry.marker) continue
    if (targets[entry.index]) {
      group.trimmed++
      if (obsoleteSystems.has(entry.index)) {
        obsoleteSystemNodes++
        obsoleteSystemChars += obsoleteSystems.get(entry.index)
      }
    } else {
      group.retained++
      protectedNodes++
      if (entry.type === 'system/message' || entry.type === 'developer/message') protectedInstructionNodes++
    }
  }
  const protectedTurns = discardGroups.filter(group => group.retained > 0).length
  const removedHistoricalTurns = discardGroups.filter(group => group.trimmed > 0 && group.retained === 0).length
  const trimmedHistoricalTurns = discardGroups.filter(group => group.trimmed > 0).length
  return {
    range: ranges[0] ?? null, ranges, keptHistoricalTurns,
    removedHistoricalTurns, trimmedHistoricalTurns, protectedTurns, protectedNodes,
    obsoleteSystemNodes, obsoleteSystemChars, protectedInstructionNodes,
    reason: protectedTurns ? (ranges.length ? 'partial-protected' : 'skipped-protected')
      : ranges.length ? 'trim-needed' : 'nothing-safe-to-trim',
  }
}

export function createContextPacking(core) {
  const { config, now, log } = core
  const cache = new WeakMap()
  let hookMounted = false
  let replacements = 0
  let removedHistoricalTurns = 0
  let removedMessageNodes = 0
  let trimmedHistoricalTurns = 0
  let obsoleteSystemNodesRemoved = 0
  let obsoleteSystemCharsRemoved = 0
  let skipped = 0
  let partial = 0
  let last = null
  const recent = []

  function record(kind, detail = {}) {
    last = { kind, at: now().toISOString(), ...detail }
    recent.unshift(last)
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT
  }
  function policy() { return config.get('contextPacking') }

  function change(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).some(key => !['enabled', 'maxHistoryTurns'].includes(key))) {
      return { ok: false, errors: ['只支持开启状态和最近对话轮数；Token 预算及旧模式已移除'] }
    }
    const next = { ...policy(), ...patch }
    if (typeof next.enabled !== 'boolean'
      || !Number.isSafeInteger(next.maxHistoryTurns) || next.maxHistoryTurns < 1 || next.maxHistoryTurns > 20) {
      return { ok: false, errors: ['轮数必须是 1–20 的整数'] }
    }
    if (next.enabled && !hookMounted) return { ok: false, errors: ['DSH agent/pre-step 钩子尚未挂载，无法开启'] }
    const result = config.set('contextPacking', next)
    if (result.ok) record('configuration', { enabled: next.enabled, turns: next.maxHistoryTurns })
    return { ok: result.ok, errors: result.errors, config: config.get('contextPacking') }
  }

  function pack(session, settings) {
    const state = inspectSession(session, cache.get(session))
    cache.set(session, state)
    const plan = selectHistoryPrefix(session, settings, state)
    if (!plan.ranges?.length) {
      if (plan.protectedTurns || plan.reason === 'nothing-safe-to-trim') {
        skipped++
        record('skipped', {
          reason: `有 ${plan.protectedTurns ?? 0} 个受保护旧轮次；已继续会话，实际历史可能超过最近 ${settings.maxHistoryTurns} 轮`,
          sessionId: String(session.id ?? 'unknown').slice(0, 80),
        })
      }
      return plan
    }
    // Verify all boundaries before any mutation; never touch current or pinned content.
    for (const range of plan.ranges) {
      const start = session.surface.nodes.indexOf(range.startSeq)
      const end = session.surface.nodes.indexOf(range.endSeq)
      if (start < 0 || end < start || session.surface.nodes.slice(start, end + 1).some(
        (seq, index) => seq !== range.sourceEventSeqs[index]
      ) || end - start + 1 !== range.sourceEventSeqs.length) {
        throw new Error('裁剪时会话 surface 已变化，已跳过本次裁剪')
      }
    }
    for (const range of plan.ranges) {
      session.append('user/message', {
        // DSH V4 requires every durable user/message to carry its own identity.
        // The surface-replacement append path does NOT auto-generate message IDs.
        id: randomUUID(),
        role: 'user', content: [{ type: 'text', text: MARKER }], source: { kind: SOURCE_KIND },
      }, {
        surfaceOp: { op: 'replace', startSeq: range.startSeq, endSeq: range.endSeq },
        sourceEventSeqs: range.sourceEventSeqs,
      })
      replacements++
      removedMessageNodes += range.removedMessageNodes
    }
    removedHistoricalTurns += plan.removedHistoricalTurns
    trimmedHistoricalTurns += plan.trimmedHistoricalTurns
    obsoleteSystemNodesRemoved += plan.obsoleteSystemNodes
    obsoleteSystemCharsRemoved += plan.obsoleteSystemChars
    if (plan.protectedTurns) partial++
    record(plan.protectedTurns ? 'partial' : 'trimmed', {
      sessionId: String(session.id ?? 'unknown').slice(0, 80),
      removedMessageNodes: plan.ranges.reduce((count, range) => count + range.removedMessageNodes, 0),
      removedHistoricalTurns: plan.removedHistoricalTurns, trimmedHistoricalTurns: plan.trimmedHistoricalTurns,
      protectedNodes: plan.protectedNodes, protectedInstructionNodes: plan.protectedInstructionNodes,
      obsoleteSystemNodes: plan.obsoleteSystemNodes, obsoleteSystemChars: plan.obsoleteSystemChars,
      ranges: plan.ranges.length,
      keptHistoricalTurns: plan.keptHistoricalTurns, protectedTurns: plan.protectedTurns,
      ...(plan.protectedTurns ? { reason: '受保护旧轮次仍保留；本次仅移除安全历史，可能超出所选轮数' } : {}),
    })
    return plan
  }

  function attach(ctx) {
    if (typeof ctx?.on !== 'function') throw new Error('DSH agent/pre-step 不可用')
    const unsub = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (!policy()?.enabled || signal?.aborted || decision?.kind !== 'enter') return decision
      try { pack(agent?.session, policy()) } catch (error) {
        skipped++
        record('skipped', {
          reason: `无法安全裁剪，已继续会话：${String(error?.message ?? error).slice(0, 170)}`,
          sessionId: String(agent?.session?.id ?? 'unknown').slice(0, 80),
        })
        log?.warn('context packing skipped; normal model request is allowed', error)
      }
      return decision
    })
    hookMounted = true
    return () => {
      try { unsub?.() } catch { /* no-op */ }
      hookMounted = false
    }
  }

  return {
    attach, pack, change,
    snapshot: () => ({
      ...policy(), hookMounted,
      replacements, removedHistoricalTurns, trimmedHistoricalTurns, removedMessageNodes, skipped, partial, blocked: 0,
      obsoleteSystemNodesRemoved, obsoleteSystemCharsRemoved,
      last, recent: recent.slice(0, 5),
      scope: 'completed historical model-visible nodes; verified superseded DSH in-history system prompts only; protect system head, latest prompt, developer/tool changes, live turn',
    }),
  }
}
