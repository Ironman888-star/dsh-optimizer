import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { classifySideEffect } from '../lib/checkpoint.js'
import { makeCore, makeCtx, session, sessionEvent, headerEvent, assistantEvent } from './helpers.js'

test('checkpoint: write/edit file calls are workspace writes that record the path', () => {
  const result = classifySideEffect('write', { file_path: 'E:/proj/a.txt', content: 'x' })
  assert.equal(result.risk, 'workspace-write')
  assert.match(result.label, /E:\/proj\/a\.txt|E:\/proj\/a\.txt/)
  assert.equal(classifySideEffect('edit', { file_path: 'a.js' }).risk, 'workspace-write')
})

test('checkpoint: destructive shell commands are flagged, read-only ones are not', () => {
  assert.equal(classifySideEffect('pwsh', { command: 'Remove-Item -Recurse build' }).risk, 'shell-write')
  assert.equal(classifySideEffect('bash', { command: 'git push origin main' }).risk, 'shell-write')
  assert.equal(classifySideEffect('bash', { command: 'Get-ChildItem' }).risk, 'none')
  assert.equal(classifySideEffect('bash', { command: 'node --test' }).risk, 'none')
})

test('checkpoint: plugin, external, memory and subagent tools are classified', () => {
  assert.equal(classifySideEffect('plugin_manager', {}).risk, 'system')
  assert.equal(classifySideEffect('qq_send', { text: 'hi' }).risk, 'external')
  assert.equal(classifySideEffect('mcp__astrbot__send', {}).risk, 'external')
  assert.equal(classifySideEffect('memory_save', { text: '喜欢调皮' }).risk, 'memory-write')
  assert.equal(classifySideEffect('spawn_teammate', { name: 'a' }).risk, 'agent-spawn')
  assert.equal(classifySideEffect('read', { file_path: 'a.js' }).risk, 'none')
})

test('checkpoint: turn end writes a checkpoint with unresolved side effects', async () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.checkpoint.attach(ctx)

  ctx.emit('session/event', session('sess-a'), headerEvent())
  ctx.emit('session/event', session('sess-a'), sessionEvent('turn/start', { turn: 1 }))
  ctx.emit('session/event', session('sess-a'), sessionEvent('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: { command: 'git push' } }))
  ctx.emit('session/event', session('sess-a'), sessionEvent('turn/end', { turn: 1, reason: 'interrupted' }))

  const index = core.checkpoint.snapshot().items
  assert.equal(index.length, 1)
  assert.equal(index[0].taskId, 'sess-a')
  assert.equal(index[0].pendingActions, 1, 'interrupted side effect must survive the turn')
  assert.equal(index[0].risk, 'review')

  const plan = core.checkpoint.plan({ taskId: 'sess-a' })
  assert.equal(plan.found, true)
  assert.equal(plan.canResume, false, 'unconfirmed side effect blocks auto-resume')
  assert.equal(plan.requiresConfirmation, true)
  assert.ok(plan.reasons.some((reason) => reason.includes('副作用')))
  assert.ok(plan.steps.some((step) => step.includes('禁止')))
})

test('checkpoint: resolved tool calls leave a safe checkpoint', async () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.checkpoint.attach(ctx)

  const s = session('sess-b')
  ctx.emit('session/event', s, sessionEvent('turn/start', { turn: 1 }))
  ctx.emit('session/event', s, sessionEvent('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: { file_path: 'a.txt' } }))
  ctx.emit('session/event', s, sessionEvent('tool/result', { turn: 1, step: 1, callId: 'c1', message: { toolName: 'write' } }))
  ctx.emit('session/event', s, assistantEvent({ inputTokens: 100, outputTokens: 10 }))
  ctx.emit('session/event', s, sessionEvent('turn/end', { turn: 1, reason: 'done' }))

  const plan = core.checkpoint.plan({ taskId: 'sess-b' })
  assert.equal(plan.canResume, true)
  assert.equal(plan.requiresConfirmation, false)
  assert.deepEqual(plan.checkpoint.changedFiles, ['a.txt'])
})

test('checkpoint: unknown task reports not found without writing anything', () => {
  const core = makeCore()
  const plan = core.checkpoint.plan({ taskId: 'nope' })
  assert.equal(plan.found, false)
  assert.equal(plan.canResume, false)
  assert.ok(plan.reasons.length > 0)
})

test('checkpoint: disabled switch makes it inert', async () => {
  const core = makeCore({ config: { 'checkpoint.enabled': false } })
  const ctx = makeCtx()
  core.checkpoint.attach(ctx)
  const s = session('sess-c')
  ctx.emit('session/event', s, sessionEvent('turn/start', { turn: 1 }))
  ctx.emit('session/event', s, sessionEvent('turn/end', { turn: 1 }))
  assert.equal(core.checkpoint.snapshot().items.length, 0)
})

test('checkpoint: index file is written and reloads on a fresh instance', async () => {
  const core = makeCore()
  const ctx = makeCtx()
  core.checkpoint.attach(ctx)
  const s = session('sess-d')
  ctx.emit('session/event', s, sessionEvent('turn/start', { turn: 1 }))
  ctx.emit('session/event', s, sessionEvent('turn/end', { turn: 1 }))

  const file = path.join(core.paths.root, 'state', 'checkpoints.json')
  assert.equal(fs.existsSync(file), true)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.items.length, 1)
  const recordFile = path.join(core.paths.root, 'checkpoints', 'sess-d.json')
  assert.equal(fs.existsSync(recordFile), true)
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
  assert.equal(record.taskId, 'sess-d')
  assert.equal(record.v, 1)
})
