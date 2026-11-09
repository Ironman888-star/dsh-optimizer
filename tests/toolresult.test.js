import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { makeCore, makeCtx } from './helpers.js'

const big = (n) => 'L' + 'x'.repeat(n)

function exec(tool, sessionId = 'sess-1') {
  return { name: tool, agent: { session: { id: sessionId } } }
}

function result(text, extra = {}) {
  return { content: [{ type: 'text', text }], isError: false, ...extra }
}

test('tool-result: small outputs pass through untouched in every mode', () => {
  const core = makeCore()
  const decision = core.toolresult.shape(exec('read'), result('hello'))
  assert.equal(decision, null)
  assert.equal(core.toolresult.stats().pruned, 0)
})

test('tool-result: enforce spills the full text and returns head+marker+tail', () => {
  const core = makeCore({ config: { mode: 'enforce', 'toolResult.maxChars': 1000, 'toolResult.headChars': 200, 'toolResult.tailChars': 100 } })
  const text = big(9000)
  const decision = core.toolresult.shape(exec('pwsh'), result(text))

  assert.equal(decision.kind, 'accept')
  const shaped = decision.content[0].text
  assert.ok(shaped.length < text.length, 'shaped text must be shorter than the original')
  assert.match(shaped, /已精简 \d+ 字符 \/ 原始 9001 字符/)
  assert.ok(shaped.startsWith('Lxxx'), 'head must be preserved')
  assert.ok(shaped.endsWith('x'.repeat(50)), 'tail must be preserved')

  const marker = shaped.split('\n\n').find((line) => line.includes('完整输出已保存'))
  assert.ok(marker, 'marker must name the spill file')
  const file = marker.slice(marker.indexOf('：') + 1, marker.lastIndexOf(']'))
  assert.ok(fs.existsSync(file), `spill file must exist: ${file}`)
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'spill must hold the byte-exact original')

  const stats = core.toolresult.stats()
  assert.equal(stats.pruned, 1)
  assert.ok(stats.savedChars > 7000)
  assert.ok(stats.savedTokensEst > 1000)
})

test('tool-result: audit mode measures the opportunity but never rewrites input', () => {
  const core = makeCore({ config: { 'toolResult.maxChars': 500 } })
  const decision = core.toolresult.shape(exec('pwsh'), result(big(5000)))
  assert.equal(decision, null, 'audit mode must not change what the model sees')
  const stats = core.toolresult.stats()
  assert.equal(stats.pruned, 0)
  assert.equal(stats.opportunities, 1)
  assert.ok(stats.opportunityChars > 4000)
  assert.equal(stats.savedChars, 0)
})

test('tool-result: failures are kept intact even in enforce mode', () => {
  const core = makeCore({ config: { mode: 'enforce', 'toolResult.maxChars': 500 } })
  const decision = core.toolresult.shape(exec('pwsh'), { content: [{ type: 'text', text: big(5000) }], isError: true })
  assert.equal(decision, null)
  assert.equal(core.toolresult.stats().pruned, 0)
})

test('tool-result: identical large payloads dedupe inside one session only', () => {
  const core = makeCore({ config: { mode: 'enforce', 'toolResult.maxChars': 800, 'toolResult.headChars': 500, 'toolResult.tailChars': 200 } })
  const text = big(4000)
  const first = core.toolresult.shape(exec('grep', 'sess-a'), result(text))
  assert.equal(first.kind, 'accept')
  assert.match(first.content[0].text, /已精简/)

  const second = core.toolresult.shape(exec('grep', 'sess-a'), result(text))
  assert.match(second.content[0].text, /完全一致，已省略/)
  assert.equal(core.toolresult.stats().deduped, 1)

  const otherSession = core.toolresult.shape(exec('grep', 'sess-b'), result(text))
  assert.match(otherSession.content[0].text, /已精简/, 'dedupe must be per-session')
})

test('tool-result: disabling the switch restores pass-through', () => {
  const core = makeCore({ config: { mode: 'enforce', 'toolResult.enabled': false } })
  assert.equal(core.toolresult.shape(exec('read'), result(big(9000))), null)
})

test('tool-result: the post-execute waterfall never swallows a blocking decision', async () => {
  const core = makeCore({ config: { mode: 'enforce', 'toolResult.maxChars': 500 } })
  const ctx = makeCtx()
  core.toolresult.attach(ctx)
  const blocked = { kind: 'block', feedback: [{ type: 'text', text: 'nope' }] }
  const out = await ctx.emitAsync('tools/post-execute', exec('pwsh'), result(big(9000)), async () => blocked)
  assert.equal(out, blocked)
})
