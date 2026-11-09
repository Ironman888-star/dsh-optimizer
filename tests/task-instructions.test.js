import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHost } from '../lib/host.js'
import { DEFAULT_TASK_INSTRUCTIONS_TEXT, TASK_SECTION_NAME } from '../lib/task-instructions.js'
import { makeCtx, tempHome, makeReq, callRoute } from './helpers.js'

function boot(home = tempHome()) {
  const ctx = makeCtx()
  const host = createHost({ root: ctx, home })
  host.start()
  return { ctx, host, home }
}

async function action(ctx, name, payload, token = null) {
  const headers = { host: '127.0.0.1:60110' }
  if (token) headers['x-dsh-optimizer-ui-token'] = token
  return (await callRoute(ctx, '/dsh-optimizer/action.json', makeReq({ method: 'POST', headers, body: JSON.stringify({ name, payload }) }))).json()
}

async function token(ctx) {
  return (await callRoute(ctx, '/dsh-optimizer/ui-control-token.json')).json().token
}

test('guidance: default text matches all five owner-supplied items (no invented second item)', () => {
  const {ctx,host} = boot()
  const registered = ctx.promptSections.get(TASK_SECTION_NAME)
  assert.ok(registered)
  assert.equal(registered.interpolate, false, 'literal {{…}} is not interpolated')
  for (const phrase of ['只搜索与任务直接相关', '不要重复执行无结果的搜索', '找不到证据时说明不确定性', '每轮结束检查', '达到工具调用上限']) {
    assert.ok(registered.text().includes(phrase))
  }
  assert.equal(host.status().taskInstructions.sectionMounted, true)
  host.dispose()
  assert.equal(ctx.promptSections.has(TASK_SECTION_NAME), false)
})

test('guidance: owner edits persist and affect next prompt assembly, without extra duplicate sections', async () => {
  const {ctx,host,home} = boot()
  const spec = ctx.promptSections.get(TASK_SECTION_NAME)
  assert.ok(spec.text().includes(DEFAULT_TASK_INSTRUCTIONS_TEXT))
  assert.equal((await action(ctx, 'setTaskInstructions', { text: '新规范' })).ok, false, 'UI token required')
  const ok = await action(ctx, 'setTaskInstructions', { text: '新增工作方法：先确认证据。\n{{literal}}' }, await token(ctx))
  assert.equal(ok.ok, true)
  assert.match(spec.text(), /新增工作方法/)
  assert.match(spec.text(), /{{literal}}/)
  assert.equal(ctx.promptSections.size, 1)
  host.dispose()
  const restart = boot(home)
  assert.match(restart.ctx.promptSections.get(TASK_SECTION_NAME).text(), /先确认证据/)
  restart.host.dispose()
})

test('guidance: malformed/oversized text is rejected without changing persisted instructions', async () => {
  const {ctx,host} = boot()
  const before = host.config.get('taskInstructions.text')
  assert.equal((await action(ctx, 'setTaskInstructions', { text: 'x'.repeat(12001) }, await token(ctx))).ok, false)
  assert.equal((await action(ctx, 'setTaskInstructions', { text: 43 }, await token(ctx))).ok, false)
  assert.equal(host.config.get('taskInstructions.text'), before)
  assert.equal((await action(ctx, 'setConfig', { path: 'taskInstructions.text', value: '绕过' })).ok, false)
  assert.equal(host.config.get('taskInstructions.text'), before)
  assert.equal((await action(ctx, 'setTaskInstructions', { text: '' }, await token(ctx))).ok, true)
  assert.equal(ctx.promptSections.get(TASK_SECTION_NAME).text(), '', 'empty input stops injection')
  host.dispose()
})

test('guidance: old access guard config is removed and pre-execution hooks are never registered', () => {
  const home = tempHome()
  const folder = path.join(home, 'storages', 'dsh-optimizer')
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify({ accessGuard: { enabled: true }, contextPacking: {enabled: true, maxHistoryTurns: 2} }))
  const {ctx,host} = boot(home)
  assert.equal('accessGuard' in host.status(), false)
  assert.equal('accessGuard' in host.config.snapshot(), false)
  assert.equal(ctx.listeners.has('tools/pre-execute'), false)
  assert.equal(ctx.listeners.has('tools/execute'), false)
  assert.equal(host.config.get('contextPacking.maxHistoryTurns'), 2)
  assert.equal(host.config.get('contextPacking.enabled'), true)
  host.dispose()
})

test('guidance: section registration unsupported does not block boot or conversation', () => {
  const ctx = makeCtx({ services: { systemPrompt: {} } })
  const host = createHost({ root: ctx, home: tempHome() })
  assert.doesNotThrow(() => host.start())
  assert.equal(host.status().taskInstructions.sectionMounted, false)
  host.dispose()
})
