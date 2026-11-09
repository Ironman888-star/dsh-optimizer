import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { dayKey, stamp, sanitizeId, isInside, ensureLayout, resolveStateRoot, ledgerFile, spillFile, checkpointFile, SUBDIRS } from '../lib/paths.js'
import { readJson, writeJson, appendJsonl, readJsonl, listFiles } from '../lib/store.js'
import { tempHome } from './helpers.js'

test('paths: dayKey uses the Asia/Shanghai calendar day', () => {
  // 2026-11-06T16:30:00Z is 2026-11-07 00:30 in Shanghai.
  assert.equal(dayKey(new Date('2026-11-06T16:30:00Z')), '2026-11-07')
  assert.equal(dayKey(new Date('2026-11-06T15:59:00Z')), '2026-11-06')
})

test('paths: sanitizeId strips separators and bounds length', () => {
  assert.equal(sanitizeId('a/b c\\d:e'), 'a_b_c_d_e')
  assert.equal(sanitizeId(''), 'unknown')
  assert.ok(sanitizeId('x'.repeat(400)).length <= 120)
})

test('paths: isInside fences traversal', () => {
  const root = path.resolve('C:/state/spill')
  assert.equal(isInside(root, path.join(root, 'a.txt')), true)
  assert.equal(isInside(root, path.join(root, '..', 'secret.txt')), false)
  assert.equal(isInside(root, root), false)
})

test('paths: resolveStateRoot honours DSH_HOME and explicit override', () => {
  const home = tempHome()
  assert.equal(resolveStateRoot(''), path.join(home, 'storages', 'dsh-optimizer'))
  const custom = path.join(home, 'custom-state')
  assert.equal(resolveStateRoot(custom), path.resolve(custom))
})

test('paths: layout creates every subdirectory and target builders stay inside', () => {
  const home = tempHome()
  const root = path.join(home, 'storages', 'dsh-optimizer')
  const layout = ensureLayout(root)
  for (const sub of SUBDIRS) assert.ok(fs.existsSync(path.join(root, sub)), `missing ${sub}`)
  assert.equal(layout.created.length, SUBDIRS.length)
  assert.ok(ledgerFile(root, '2026-11-06').endsWith(path.join('ledger', '2026-11-06.jsonl')))
  assert.ok(spillFile(root, 'x').endsWith(path.join('spill', 'x.txt')))
  assert.ok(checkpointFile(root, '../evil').endsWith('evil.json'))
  assert.equal(isInside(path.join(root, 'checkpoints'), checkpointFile(root, '../evil')), true)
})

test('store: writeJson round-trips atomically and survives a missing file', () => {
  const home = tempHome()
  const file = path.join(home, 'state', 'a.json')
  assert.deepEqual(readJson(file, { fallback: true }), { fallback: true })
  writeJson(file, { x: 1, nested: { y: [1, 2] } })
  assert.deepEqual(readJson(file, null), { x: 1, nested: { y: [1, 2] } })
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'tmp file must be renamed away')
  // Corrupt content degrades to the fallback rather than throwing.
  fs.writeFileSync(file, '{oops')
  assert.deepEqual(readJson(file, { fallback: true }), { fallback: true })
})

test('store: jsonl append/read honour the tail limit', () => {
  const home = tempHome()
  const file = path.join(home, 'ledger', '2026-11-06.jsonl')
  appendJsonl(file, [{ n: 1 }, { n: 2 }])
  appendJsonl(file, [{ n: 3 }])
  const all = readJsonl(file)
  assert.deepEqual(all.map((row) => row.n), [1, 2, 3])
  const tail = readJsonl(file, { limit: 2 })
  assert.deepEqual(tail.map((row) => row.n), [2, 3])
  assert.deepEqual(readJsonl(path.join(home, 'missing.jsonl')), [])
})

test('store: listFiles filters by extension', () => {
  const home = tempHome()
  const dir = path.join(home, 'spill')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x')
  fs.writeFileSync(path.join(dir, 'b.json'), '{}')
  assert.equal(listFiles(dir).length, 2)
  assert.equal(listFiles(dir, (name) => name.endsWith('.txt')).length, 1)
})

test('paths: stamp is filesystem safe', () => {
  const value = stamp(new Date('2026-11-06T13:45:00.123Z'))
  assert.equal(value, '2026-11-06T13-45-00-123Z')
  assert.equal(/[:.]/.test(value), false)
})
