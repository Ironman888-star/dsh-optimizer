import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_CONFIG,
  mergeConfig,
  validateConfig,
  getPath,
  setPath,
  createConfigStore,
} from '../lib/config.js'
import { tempHome, silentLog } from './helpers.js'

test('config: defaults cover every documented switch', () => {
  assert.equal(DEFAULT_CONFIG.enabled, true)
  assert.equal(DEFAULT_CONFIG.mode, 'audit')
  assert.equal(DEFAULT_CONFIG.toolResult.enabled, true)
  assert.equal(DEFAULT_CONFIG.checkpoint.autoResume, false)
  assert.equal(DEFAULT_CONFIG.server.allowConfigWrite, true)
  assert.ok(Object.isFrozen(DEFAULT_CONFIG))
})

test('config: mergeConfig deep-merges known keys and drops unknown ones', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    mode: 'enforce',
    budgets: { dailyUSD: 7 },
    unknownKey: true,
    toolResult: { maxChars: 'not-a-number' },
  })
  assert.equal(merged.mode, 'enforce')
  assert.equal(merged.budgets.dailyUSD, 7)
  assert.equal(merged.unknownKey, undefined)
  // Type mismatch is ignored, not coerced.
  assert.equal(merged.toolResult.maxChars, DEFAULT_CONFIG.toolResult.maxChars)
})

test('config: validateConfig rejects impossible values and repairs them', () => {
  const { config, errors } = validateConfig({
    mode: 'turbo',
    budgets: { dailyUSD: -1, warnRatio: 2 },
    retention: { ledgerDays: 0 },
  })
  assert.ok(errors.length >= 4)
  assert.equal(config.mode, 'audit')
  assert.equal(config.budgets.dailyUSD, 5)
  assert.equal(config.budgets.warnRatio, 0.8)
  assert.equal(config.retention.ledgerDays, 90)
})

test('config: getPath and setPath walk dot paths', () => {
  const target = { a: { b: 1 } }
  assert.equal(getPath(target, 'a.b'), 1)
  assert.equal(getPath(target, 'a.c.d'), undefined)
  setPath(target, 'a.c.d', 2)
  assert.equal(target.a.c.d, 2)
})

test('config: store persists, reloads and refuses invalid edits', () => {
  const home = tempHome()
  const file = path.join(home, 'config.json')
  const store = createConfigStore({ file, log: silentLog })

  assert.equal(store.get('mode'), 'audit')
  assert.equal(store.set('mode', 'enforce').ok, true)
  assert.equal(store.get('mode'), 'enforce')

  const bad = store.set('budgets.dailyUSD', -5)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.length > 0)
  assert.equal(store.get('budgets.dailyUSD'), 5, 'rejected edit must not stick')

  const rejected = store.set('mode', 'nonsense')
  assert.equal(rejected.ok, false)

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.mode, 'enforce')

  const reloaded = createConfigStore({ file, log: silentLog })
  assert.equal(reloaded.get('mode'), 'enforce')
  assert.equal(reloaded.get('budgets.dailyUSD'), 5)
})

test('config: store tolerates a corrupt file', () => {
  const home = tempHome()
  const file = path.join(home, 'config.json')
  fs.writeFileSync(file, '{not json')
  const store = createConfigStore({ file, log: silentLog })
  assert.equal(store.get('mode'), 'audit')
})
