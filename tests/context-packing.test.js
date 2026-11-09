import test from 'node:test'
import assert from 'node:assert/strict'
import { createContextPacking, selectHistoryPrefix } from '../lib/context-packing.js'
import { createHost } from '../lib/host.js'
import { makeCore, makeCtx, tempHome, callRoute, makeReq } from './helpers.js'

class FakeSession {
  constructor() {
    this.id = 'test-session'
    this.events = []
    this.surface = { nodes: [], replaceGeneration: 0 }
    this.append('system/message', { turn: 0, step: 0, message: { role: 'system', content: [{ type: 'text', text: 'System instructions' }] } }, { surfaceOp: 'append' })
  }
  get seq() { return this.events.length }
  eventAt(seq) { return this.events[seq] }
  snapshotEvents(from = 0, end = this.seq) { return this.events.slice(from, end) }
  deriveEventMessage(event) {
    return event?.data?.message ?? (event?.type === 'user/message' ? event.data : null)
  }
  append(type, data, opts) {
    // Mimic the strict V4 replay identity requirement for plugin replacement
    // messages; the real Session.append() does not mint an id on this path.
    if (type === 'user/message' && data?.source?.kind === 'dsh-optimizer-context-packing') {
      assert.match(data.id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'every replacement marker requires a unique UUIDv4 message id')
    }
    const seq = this.events.length
    const event = { type, data, seq, time: Date.now(), ...(opts ?? {}) }
    if (opts?.surfaceOp === 'append') this.surface.nodes.push(seq)
    else if (opts?.surfaceOp?.op === 'replace') {
      const { startSeq, endSeq } = opts.surfaceOp
      const start = this.surface.nodes.indexOf(startSeq)
      const end = this.surface.nodes.indexOf(endSeq)
      assert.ok(start >= 0 && end >= start, 'valid ordered replacement')
      assert.deepEqual(opts.sourceEventSeqs, this.surface.nodes.slice(start, end + 1))
      assert.equal(this.events[this.surface.nodes[0]].type, 'system/message')
      assert.ok(start > 0, 'system head pinned')
      this.surface.nodes.splice(start, end - start + 1, seq)
      this.surface.replaceGeneration++
    }
    this.events.push(event)
    return event
  }
  turn(turn, text = 'answer') {
    this.append('turn/start', { turn })
    this.append('step/start', { turn, step: 1 })
    this.append('user/message', { role: 'user', content: [{ type: 'text', text: `user ${turn} ` + text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    this.append('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: `assistant ${turn} ${text}` }] } }, { surfaceOp: 'append' })
    this.append('step/end', { turn, step: 1 })
    this.append('turn/end', { turn, reason: 'completed' })
  }
  liveTurn(turn) {
    this.append('turn/start', { turn })
    this.append('step/start', { turn, step: 1 })
    this.append('user/message', { role: 'user', content: [{ type: 'text', text: `current ${turn}` }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  }
  texts() {
    return this.surface.nodes.map((seq) => this.deriveEventMessage(this.eventAt(seq))?.content?.[0]?.text).filter(Boolean)
  }
}

const next = async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'next message' }] }] })
function attach(core) {
  const guard = createContextPacking(core)
  const ctx = makeCtx({ services: { tokenMeter: { estimateMessage: (message) => Math.ceil(JSON.stringify(message).length / 2) } } })
  guard.attach(ctx)
  const preStep = ctx.listeners.get('agent/pre-step')?.[0]
  assert.equal(typeof preStep, 'function')
  return { guard, ctx, preStep }
}
function pre(preStep, session, turn) {
  return preStep({ agent: { session }, turn, step: 1, signal: new AbortController().signal }, next)
}

test('default off: historical surface and request admission unchanged', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 5; t++) session.turn(t)
  session.append('turn/start', { turn: 6 })
  const before = [...session.surface.nodes]
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.deepEqual(session.surface.nodes, before)
  assert.equal(guard.snapshot().enabled, false)
})

test('rounds mode keeps only three closed rounds before current input and does not delete logged history', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 6; t++) session.turn(t)
  session.liveTurn(7)
  const n = session.events.length
  assert.equal(guard.change({ enabled: true, maxHistoryTurns: 3 }).ok, true)
  assert.equal((await pre(preStep, session, 7)).kind, 'enter')
  assert.equal(session.texts().some(x => x.includes('user 1 ')), false)
  assert.equal(session.texts().some(x => x.includes('user 2 ')), false)
  assert.equal(session.texts().some(x => x.includes('user 3 ')), false)
  assert.ok(session.texts().some(x => x.includes('user 4 ')))
  assert.ok(session.texts().some(x => x.includes('user 6 ')))
  assert.ok(session.texts().some(x => x.includes('current 7')))
  assert.equal(session.eventAt(3).data.content[0].text.includes('user 1 '), true)
  assert.equal(session.events.length, n + 1) // a deterministic replacement, not log deletion
  assert.equal(guard.snapshot().replacements, 1)
  assert.equal((await pre(preStep, session, 7)).kind, 'enter')
  assert.equal(guard.snapshot().replacements, 1) // idempotent within turn
})

test('round-count-only mode ignores message size and keeps exactly two recent completed turns', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 5; t++) session.turn(t, 'a'.repeat(3000))
  session.liveTurn(6)
  assert.equal(guard.change({ enabled: true, maxHistoryTurns: 2 }).ok, true)
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const visible = session.texts().join('\n')
  for (let t = 1; t <= 3; t++) assert.doesNotMatch(visible, new RegExp(`user ${t} `))
  for (let t = 4; t <= 5; t++) assert.match(visible, new RegExp(`user ${t} `))
  assert.match(visible, /current 6/)
  assert.equal(guard.snapshot().removedHistoricalTurns, 3)
  assert.equal(guard.snapshot().last.kind, 'trimmed')
  assert.equal(guard.snapshot().estimatedDroppedTokens, undefined)
})

test('round trimming leaves active tool continuation intact', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 5; t++) session.turn(t, 'x'.repeat(450))
  session.liveTurn(6)
  session.append('assistant/message', { turn: 6, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'tool call active' }] } }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 6, step: 1, callId: 'A', name: 'read', arguments: '{}' })
  session.append('tool/result', { turn: 6, step: 1, message: { role: 'tool', callId: 'A', content: [{ type: 'text', text: 'tool result' }] } }, { surfaceOp: 'append' })
  assert.equal(guard.change({ enabled: true, maxHistoryTurns: 2 }).ok, true)
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.ok(session.texts().some(x => x.includes('tool result')))
  assert.ok(session.texts().some(x => x.includes('current 6')))
  assert.equal(session.texts().some(x => x.includes('user 1')), false)
  assert.ok(guard.snapshot().replacements > 0)
})

test('interleaved system/developer instructions remain visible while other old turns are trimmed and the turn proceeds', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.turn(1)
  session.append('system/message', { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'changed system instruction' }] } }, { surfaceOp: 'append' })
  session.append('developer/message', { turn: 1, step: 1, message: { role: 'developer', content: [{ type: 'text', text: 'developer policy' }] } }, { surfaceOp: 'append' })
  for (let t = 2; t <= 5; t++) session.turn(t)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.match(visible, /System instructions/)
  assert.match(visible, /changed system instruction/)
  assert.match(visible, /developer policy/)
  assert.doesNotMatch(visible, /user 1 /) // node-level trimming leaves only pinned instructions
  assert.doesNotMatch(visible, /user 2 /)
  assert.doesNotMatch(visible, /user 3 /)
  assert.match(visible, /user 4 /)
  assert.match(visible, /current 6/)
  assert.equal(guard.snapshot().blocked, 0)
  assert.equal(guard.snapshot().last.kind, 'partial')
  assert.equal(guard.snapshot().partial, 1)
})

test('log-only tool/call events from compacted history do not pin visible messages', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.turn(1)
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'compacted turn 2' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  // tool/call is log-only and is NOT part of the model-visible surface.
  session.append('tool/call', { turn: 2, step: 1, callId: 'gone-in-compaction', name: 'bash', arguments: '{}' })
  session.append('turn/end', { turn: 2, reason: 'completed' })
  for (let t = 3; t <= 7; t++) session.turn(t)
  session.liveTurn(8)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 8)).kind, 'enter')
  assert.doesNotMatch(session.texts().join('\n'), /compacted turn 2/)
  assert.doesNotMatch(session.texts().join('\n'), /user 3 /)
  assert.equal(guard.snapshot().last.kind, 'trimmed')
})

test('a session with only protected older messages is allowed without falsely reporting savings', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 3; t++) {
    session.append('turn/start', { turn: t })
    session.append('developer/message', { turn: t, message: { role: 'developer', content: [{ type: 'text', text: 'protected-' + t }] } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: t, reason: 'completed' })
  }
  session.liveTurn(4)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 4)).kind, 'enter')
  assert.equal(guard.snapshot().replacements, 0)
  assert.equal(guard.snapshot().skipped, 1)
  assert.equal(guard.snapshot().last.kind, 'skipped')
  assert.match(session.texts().join('\n'), /protected-1/)
})

test('unsupported session API cannot terminate normal conversation', async () => {
  const { guard, preStep } = attach(makeCore())
  guard.change({ enabled: true })
  assert.equal((await pre(preStep, { id: 'no-surface' }, 1)).kind, 'enter')
  assert.equal(guard.snapshot().skipped, 1)
  assert.match(guard.snapshot().last.reason, /会话/)
})

test('multiple safe segments separated by pinned instructions trim independently', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 5; t++) {
    session.turn(t)
    if (t === 3) session.append('developer/message', { turn: t, message: { role: 'developer', content: [{ type: 'text', text: 'keep developer 3' }] } }, { surfaceOp: 'append' })
  }
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.equal(guard.snapshot().replacements, 2)
  assert.ok(session.texts().some(x => x.includes('keep developer 3')))
  assert.equal(session.texts().some(x => x.includes('user 3 ')), false)
  assert.equal(session.texts().some(x => x.includes('user 1 ')), false)
  assert.equal(session.texts().some(x => x.includes('user 4 ')), false)
  assert.equal(session.texts().some(x => x.includes('user 5 ')), true)
})

test('repeated turns do not accumulate a new replacement marker for every trimmed historical turn', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  for (let t = 1; t <= 5; t++) session.turn(t)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  // finish active turn (the marker was created during this turn)
  session.append('assistant/message', { turn: 6, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'assistant 6' }] } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 6, reason: 'completed' })
  session.liveTurn(7)
  assert.equal((await pre(preStep, session, 7)).kind, 'enter')
  const markers = session.surface.nodes.filter(seq => session.eventAt(seq).data?.source?.kind === 'dsh-optimizer-context-packing')
  assert.equal(markers.length, 1)
  assert.equal(guard.snapshot().blocked, 0)
})

test('configuration validates inputs; generic action cannot bypass dedicated control', async () => {
  const ctx = makeCtx()
  const host = createHost({ root: ctx, home: tempHome() })
  host.start()
  assert.equal(host.status().contextPacking.enabled, false)
  assert.equal(host.status().contextPacking.hookMounted, true)
  assert.equal(host.actions('setConfig', { path: 'contextPacking.enabled', value: true }).ok, false)
  assert.equal(host.actions('setConfig', { path: 'contextPacking', value: { enabled: true } }).ok, false)
  assert.equal(host.actions('setPackingConfig', { enabled: true }).ok, false)
  assert.equal(host.ownerControl('setPackingConfig', { enabled: true, maxHistoryTurns: 0 }).ok, false)
  const request = makeReq({ method: 'POST', headers: { host: '127.0.0.1:60110' }, body: JSON.stringify({ name: 'setPackingConfig', payload: { enabled: true, maxHistoryTurns: 3 } }) })
  assert.equal((await callRoute(ctx, '/dsh-optimizer/action.json', request)).json().ok, false)
  const token = (await callRoute(ctx, '/dsh-optimizer/ui-control-token.json')).json().token
  const response = await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', headers: { host: '127.0.0.1:60110', 'x-dsh-optimizer-ui-token': token }, body: JSON.stringify({ name: 'setPackingConfig', payload: { enabled: true, maxHistoryTurns: 3 } }) }))
  assert.equal(response.json().ok, true)
  assert.equal(host.status().contextPacking.enabled, true)
  host.dispose()
})

test('configuration persists after restart; independent of analytics', () => {
  const home = tempHome()
  const ctx1 = makeCtx()
  const host1 = createHost({ root: ctx1, home })
  host1.config.set('enabled', false)
  host1.start()
  assert.equal(host1.ownerControl('setPackingConfig', { enabled: true, maxHistoryTurns: 3 }).ok, true)
  host1.dispose()
  const ctx2 = makeCtx()
  const host2 = createHost({ root: ctx2, home })
  host2.start()
  assert.equal(host2.status().contextPacking.enabled, true)
  assert.deepEqual(Object.keys(host2.status().contextPacking).filter(x => ['enabled','maxHistoryTurns'].includes(x)).sort(), ['enabled','maxHistoryTurns'])
  assert.equal(host2.status().contextPacking.maxHistoryTurns, 3)
  assert.equal('accessGuard' in host2.status(), false)
  assert.equal(host2.status().modules.find(x => x.id === 'contextPacking')?.state, 'mounted')
  host2.dispose()
})


test('removed token modes cannot be supplied to the dedicated owner action', () => {
  const { guard } = attach(makeCore())
  assert.equal(guard.change({ enabled: true, mode: 'tokens', maxHistoryTurns: 3 }).ok, false)
  assert.equal(guard.change({ enabled: true, mode: 'hybrid', historyTokenBudget: 8192 }).ok, false)
  assert.equal(guard.change({ enabled: true, historyTokenBudget: 8192 }).ok, false)
  assert.equal(guard.snapshot().enabled, false)
})

test('upgrade silently removes old hybrid/token config fields while preserving turn count and enabled state', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const home = tempHome()
  const stateRoot = path.join(home, 'storages', 'dsh-optimizer')
  fs.mkdirSync(stateRoot, { recursive: true })
  fs.writeFileSync(path.join(stateRoot, 'config.json'), JSON.stringify({
    contextPacking: { enabled: true, mode: 'hybrid', historyTokenBudget: 8192, maxHistoryTurns: 2 },
    accessGuard: { enabled: false },
  }))
  const host = createHost({ root: makeCtx(), home })
  host.start()
  const cfg = host.status().config.contextPacking
  assert.deepEqual(cfg, { enabled: true, maxHistoryTurns: 2 })
  const saved = JSON.parse(fs.readFileSync(path.join(stateRoot, 'config.json'), 'utf8'))
  assert.deepEqual(saved.contextPacking, cfg)
  assert.equal('accessGuard' in saved, false, 'stale guard config is removed on upgrade')
  host.dispose()
})

test('no restrictive token mode exists in configuration or client', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { DEFAULT_CONFIG } = await import('../lib/config.js')
  assert.deepEqual(DEFAULT_CONFIG.contextPacking, { enabled: false, maxHistoryTurns: 3 })
  const client = fs.readFileSync(path.join(import.meta.dirname, '../client.js'), 'utf8')
  const panel = client.slice(client.indexOf('function ContextPackingPanel('), client.indexOf('/* ── settings page'))
  assert.doesNotMatch(panel, /historyTokenBudget|packing\.mode|Token 上限（估算）|value: 'hybrid'|value: 'tokens'/)
  assert.match(panel, /保留最近几轮/)
  assert.match(panel, /role: 'switch'/)
})

// Reconstruct provider-visible tool boundaries, not the append-only tool/call audit log.
function appendVisibleToolPair(session, turn, name, id, { result = true } = {}) {
  session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [
    { type: 'text', text: name }, { type: 'tool-call', id, name: 'read', arguments: '{}' },
  ] } }, { surfaceOp: 'append' })
  session.append('tool/call', { turn, step: 1, callId: id, name: 'read', arguments: '{}' })
  if (result) session.append('tool/result', { turn, step: 1, message: {
    role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id },
    content: [{ type: 'text', text: `result:${id}` }],
  } }, { surfaceOp: 'append' })
}

test('visible completed call/result pair is trimmed together, despite stale log-only call events', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'old task' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendVisibleToolPair(session, 1, 'old tool', 'tool-1')
  session.append('turn/end', { turn: 1, reason: 'completed' })
  for (let t = 2; t <= 5; t++) session.turn(t)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const content = session.surface.nodes.map(seq => session.eventAt(seq).data?.message?.content ?? [])
    .flat().map(block => block?.text).filter(Boolean).join('\n')
  assert.doesNotMatch(content, /old tool|result:tool-1/)
  assert.equal(guard.snapshot().last.kind, 'trimmed')
})

test('mixed protected system+developer nodes no longer pin 100k ordinary text in same old turn', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'OLD_BIG_' + 'a'.repeat(100000) }] }, { surfaceOp: 'append' })
  session.append('system/message', { turn: 1, message: { role: 'system', content: [{ type: 'text', text: 'SYSTEM_PINNED' }] } }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'OLD_ASSISTANT_' + 'b'.repeat(12000) }] } }, { surfaceOp: 'append' })
  session.append('developer/message', { turn: 1, message: { role: 'developer', content: [{ type: 'text', text: 'DEVELOPER_PINNED' }] } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: 'completed' })
  for (let t = 2; t <= 5; t++) session.turn(t)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.match(visible, /SYSTEM_PINNED|DEVELOPER_PINNED/)
  assert.doesNotMatch(visible, /OLD_BIG_|OLD_ASSISTANT_/)
  assert.ok(guard.snapshot().trimmedHistoricalTurns >= 1)
  assert.ok(guard.snapshot().removedMessageNodes >= 2)
  assert.equal(guard.snapshot().last.kind, 'partial')
})

test('unmatched visible tool call pins only tool-bearing nodes, trims unrelated old text', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'BEFORE_TOOL' }] }, { surfaceOp: 'append' })
  appendVisibleToolPair(session, 1, 'UNPAIRED_TOOL_CALL', 'orphan', { result: false })
  session.append('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'AFTER_TOOL' }] } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: 'completed' })
  for (let t = 2; t <= 4; t++) session.turn(t)
  session.liveTurn(5)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 5)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.match(visible, /UNPAIRED_TOOL_CALL/)
  assert.doesNotMatch(visible, /BEFORE_TOOL|AFTER_TOOL/)
  assert.equal(guard.snapshot().last.kind, 'partial')
})

test('cannot leave a marker between a visible tool call and a retained tool result', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'DELETE_BEFORE' }] }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'cross', name: 'read', arguments: '{}' }] } }, { surfaceOp: 'append' })
  session.append('developer/message', { turn: 1, message: { role: 'developer', content: [{ type: 'text', text: 'pinned between pair' }] } }, { surfaceOp: 'append' })
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'NO_MARKER_HERE' }] }, { surfaceOp: 'append' })
  session.append('tool/result', { turn: 1, message: { role: 'tool', toolCallId: 'cross', source: { kind: 'tool', callId: 'cross' }, content: [{ type: 'text', text: 'result' }] } }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'DELETE_AFTER' }] } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: 'completed' })
  for (let t = 2; t <= 4; t++) session.turn(t)
  session.liveTurn(5)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 5)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.match(visible, /NO_MARKER_HERE/)
  assert.doesNotMatch(visible, /DELETE_BEFORE|DELETE_AFTER/)
})

test('previous DSH compaction checkpoint is removable when it is old; raw historic log stays intact', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.turn(1)
  const user1 = session.surface.nodes.find(seq => session.eventAt(seq).type === 'user/message')
  const answer1 = session.surface.nodes.find(seq => session.eventAt(seq).type === 'assistant/message')
  const text = 'OLD_COMPACTION_SUMMARY_' + 'x'.repeat(21000)
  session.append('user/message', { role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'c1' }, content: [{ type: 'text', text }] }, {
    surfaceOp: { op: 'replace', startSeq: user1, endSeq: answer1 }, sourceEventSeqs: [user1, answer1],
  })
  for (let t = 2; t <= 5; t++) session.turn(t)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.doesNotMatch(session.texts().join('\n'), /OLD_COMPACTION_SUMMARY_/)
  assert.equal(session.events.some(ev => ev.data?.content?.[0]?.text === text), true)
})

// v0.3.4: old in-history prompt snapshots are not the same as active instructions.
// The host's `request/context` plus a known system-prompt source must both
// prove that a newer complete rendering supersedes the old visible version.
function committedRoundWithPrompt(session, turn, promptText, source) {
  session.append('turn/start', { turn })
  session.append('user/message', { role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: `question-${turn}` }] }, { surfaceOp: 'append' })
  if (promptText !== null) session.append('system/message', { turn, step: 1,
    message: { role: 'system', source, content: [{ type: 'text', text: promptText }] },
  }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn, step: 1, message: { role: 'assistant',
    content: [{ type: 'text', text: `response-${turn}` }] } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: 'completed' })
}

const V3_PROMPT = { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }
const V4_PROMPT = { kind: 'system-prompt' }

for (const source of [V3_PROMPT, V4_PROMPT]) {
  test(`verified in-history DSH system prompt supersession trims obsolete non-head snapshots (${source.kind})`, async () => {
    const { guard, preStep } = attach(makeCore())
    const session = new FakeSession()
    session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
    committedRoundWithPrompt(session, 1, 'OLD_FULL_SYSTEM_PROMPT_100KB' + 'A'.repeat(30_000), source)
    committedRoundWithPrompt(session, 2, 'OLDER_FULL_SYSTEM_PROMPT_50KB' + 'B'.repeat(20_000), source)
    committedRoundWithPrompt(session, 3, 'LATEST_EFFECTIVE_SYSTEM_PROMPT', source)
    committedRoundWithPrompt(session, 4, null, source)
    committedRoundWithPrompt(session, 5, null, source)
    session.liveTurn(6)
    assert.equal(guard.change({ enabled: true, maxHistoryTurns: 2 }).ok, true)
    assert.equal((await pre(preStep, session, 6)).kind, 'enter')
    const visible = session.texts().join('\n')
    assert.match(visible, /System instructions/) // head stays untouched
    assert.match(visible, /LATEST_EFFECTIVE_SYSTEM_PROMPT/)
    assert.match(visible, /question-4|question-5/)
    assert.doesNotMatch(visible, /OLD_FULL_SYSTEM_PROMPT_100KB|OLDER_FULL_SYSTEM_PROMPT_50KB/)
    assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 2)
    assert.ok(guard.snapshot().obsoleteSystemCharsRemoved > 50_000)
    assert.equal(guard.snapshot().blocked, 0)
    // Source log still contains each historical directive for audit/replay.
    assert.ok(session.events.some(event => event.data?.message?.content?.[0]?.text?.startsWith('OLD_FULL_SYSTEM_PROMPT_100KB')))
  })
}

test('missing or incompatible route cannot establish system supersession', async () => {
  for (const route of [null, { provider: 'other', model: 'model' }]) {
    const { guard, preStep } = attach(makeCore())
    const session = new FakeSession()
    if (route) session.append('request/context', route)
    committedRoundWithPrompt(session, 1, 'OLDER_TRUSTED_SYSTEM', V3_PROMPT)
    committedRoundWithPrompt(session, 2, 'NEWER_TRUSTED_SYSTEM', V3_PROMPT)
    for (let t = 3; t <= 5; t++) committedRoundWithPrompt(session, t, null, V3_PROMPT)
    session.liveTurn(6)
    guard.change({ enabled: true, maxHistoryTurns: 2 })
    assert.equal((await pre(preStep, session, 6)).kind, 'enter')
    const visible = session.texts().join('\n')
    assert.match(visible, /OLDER_TRUSTED_SYSTEM|NEWER_TRUSTED_SYSTEM/)
    assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 0)
    assert.ok(guard.snapshot().last.protectedInstructionNodes >= 2)
  }
})

test('unknown or spoofed system sources and a later untrusted system message are never declared obsolete', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
  committedRoundWithPrompt(session, 1, 'TRUSTED_BUT_UNPROVEN_OLD_SYSTEM', V3_PROMPT)
  committedRoundWithPrompt(session, 2, 'USER_SPOOFED_SYSTEM', { kind: 'user' })
  committedRoundWithPrompt(session, 3, 'UNKNOWN_PROVIDER_SYSTEM', { kind: 'plugin', plugin: 'other-plugin' })
  for (let t = 4; t <= 5; t++) committedRoundWithPrompt(session, t, null, V3_PROMPT)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.match(visible, /TRUSTED_BUT_UNPROVEN_OLD_SYSTEM|USER_SPOOFED_SYSTEM|UNKNOWN_PROVIDER_SYSTEM/)
  assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 0)
})

test('developer instructions, including tool registry changes, survive newer system prompt snapshots', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
  committedRoundWithPrompt(session, 1, 'REMOVE_OLD_RENDERED_PROMPT', V3_PROMPT)
  session.append('developer/message', { turn: 1, step: 1, message: { role: 'developer',
    source: { kind: 'plugin', plugin: 'tool-registry' }, content: [
      { type: 'tool-addition', name: 'important_tool' }, { type: 'text', text: 'KEEP_TOOL_REGISTRY_CHANGE' },
    ],
  } }, { surfaceOp: 'append' })
  committedRoundWithPrompt(session, 2, 'KEEP_EFFECTIVE_PROMPT', V3_PROMPT)
  for (let t = 3; t <= 5; t++) committedRoundWithPrompt(session, t, null, V3_PROMPT)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  const visible = session.texts().join('\n')
  assert.doesNotMatch(visible, /REMOVE_OLD_RENDERED_PROMPT/)
  assert.match(visible, /KEEP_EFFECTIVE_PROMPT|KEEP_TOOL_REGISTRY_CHANGE/)
  assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 1)
})

test('a later request/context change away from in-history invalidates supersession evidence', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
  committedRoundWithPrompt(session, 1, 'PROMPT_BEFORE_ROUTE_CHANGE', V3_PROMPT)
  committedRoundWithPrompt(session, 2, 'PROMPT_AT_ROUTE_CHANGE', V3_PROMPT)
  session.append('request/context', { provider: 'other', model: 'new' })
  for (let t = 3; t <= 5; t++) committedRoundWithPrompt(session, t, null, V3_PROMPT)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.match(session.texts().join('\n'), /PROMPT_BEFORE_ROUTE_CHANGE/)
  assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 0)
})

test('an empty latest system node is not proof that an earlier full prompt is obsolete', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
  committedRoundWithPrompt(session, 1, 'PROMPT_WITH_NO_KNOWN_REPLACEMENT', V3_PROMPT)
  session.append('turn/start', { turn: 2 })
  session.append('system/message', { turn: 2, step: 1, message: {
    role: 'system', source: V3_PROMPT, content: [],
  } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: 'completed' })
  for (let t = 3; t <= 5; t++) committedRoundWithPrompt(session, t, null, V3_PROMPT)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 2 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.match(session.texts().join('\n'), /PROMPT_WITH_NO_KNOWN_REPLACEMENT/)
  assert.equal(guard.snapshot().obsoleteSystemNodesRemoved, 0)
})

test('system head always survives even if classified as an older completed round', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  // Head is deliberately inserted as an apparently closed historical turn.
  session.events[0].data.turn = 1
  session.events[0].data.message.source = V3_PROMPT
  session.events[0].data.message.content[0].text = 'PERMANENT_PROTECTED_HEAD'
  session.append('request/context', { provider: 'deepseek', model: 'verified', systemPromptUpdate: 'in-history' })
  for (let t = 1; t <= 5; t++) committedRoundWithPrompt(session, t,
    t === 2 ? 'LATEST_PROMPT_SNAPSHOT' : null, V3_PROMPT)
  session.liveTurn(6)
  guard.change({ enabled: true, maxHistoryTurns: 1 })
  assert.equal((await pre(preStep, session, 6)).kind, 'enter')
  assert.equal(session.surface.nodes[0], 0)
  assert.match(session.texts().join('\n'), /PERMANENT_PROTECTED_HEAD/)
  assert.match(session.texts().join('\n'), /LATEST_PROMPT_SNAPSHOT/)
})

// The v0.3.5 plugin omitted data.id and wrote non-replayable V4 replacement
// events. Exercise multiple ranges so a future omission fails before release.
test('each surface replacement marker has a distinct durable V4 user message identity', async () => {
  const { guard, preStep } = attach(makeCore())
  const session = new FakeSession()
  session.turn(1)
  session.append('developer/message', { turn: 1, message: {
    role: 'developer', content: [{ type: 'text', text: 'pinned instruction' }],
  } }, { surfaceOp: 'append' })
  for (let t = 2; t <= 6; t++) session.turn(t)
  session.liveTurn(7)
  assert.equal(guard.change({ enabled: true, maxHistoryTurns: 2 }).ok, true)
  assert.equal((await pre(preStep, session, 7)).kind, 'enter')
  const markers = session.events.filter(event => event.type === 'user/message'
    && event.data?.source?.kind === 'dsh-optimizer-context-packing')
  assert.ok(markers.length >= 2, 'multiple safe ranges produce separate replacements')
  assert.equal(new Set(markers.map(event => event.data.id)).size, markers.length)
  assert.ok(markers.every(event => event.surfaceOp?.op === 'replace'))
  // Loading the persisted events later must not encounter anonymous user nodes.
  for (const marker of markers) {
    const loaded = JSON.parse(JSON.stringify(marker))
    assert.equal(loaded.data.role, 'user')
    assert.match(loaded.data.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  }
})

test('strict V4 replay guard rejects old anonymous optimizer replacement markers', () => {
  const session = new FakeSession()
  assert.throws(() => session.append('user/message', {
    role: 'user', content: [{ type: 'text', text: 'legacy broken marker' }],
    source: { kind: 'dsh-optimizer-context-packing' },
  }, { surfaceOp: 'append' }), /requires a unique UUIDv4/)
})
