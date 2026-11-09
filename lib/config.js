/**
 * Configuration: defaults, validation, and an atomically persisted store.
 *
 * Defaults are deliberately conservative: `mode: 'audit'` means the plugin
 * measures everything but never rewrites prompts or tool results, which is
 * what the master directive requires until the owner approves enforcement.
 */
import { readJson, writeJson } from './store.js'
import { DEFAULT_TASK_INSTRUCTIONS_TEXT, MAX_TASK_INSTRUCTIONS_CHARS } from './task-instructions.js'

export const CONFIG_VERSION = 1

export const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  enabled: true,
  /** 'audit' = observe only; 'enforce' = apply prompt/tool-result shaping. */
  mode: 'audit',
  // Only model-visible history packing; does not restrict filesystem or tools.
  contextPacking: { enabled: false, maxHistoryTurns: 3 },
  taskInstructions: { text: DEFAULT_TASK_INSTRUCTIONS_TEXT },
  /** Absolute path override for the state directory; empty = <DSH_HOME>/storages/dsh-optimizer. */
  stateDir: '',
  budgets: {
    perTaskUSD: 0.5,
    perAgentUSD: 1,
    dailyUSD: 5,
    projectUSD: 50,
    warnRatio: 0.8,
  },
  context: {
    defaultBudgetTokens: 64_000,
    hardBudgetTokens: 128_000,
    warnRatio: 0.85,
    autoCompact: false,
  },
  prompt: {
    audit: true,
    /** Enforce-only: drop byte-identical duplicate blocks across sections. */
    trimDuplicates: false,
    duplicateMinChars: 200,
  },
  toolResult: {
    enabled: true,
    maxChars: 12_000,
    headChars: 4_000,
    tailChars: 3_000,
    keepErrorsIntact: true,
    dedupeWindow: 6,
  },
  checkpoint: {
    enabled: true,
    intervalMs: 45_000,
    onTurnEnd: true,
    maxPerSession: 20,
    autoResume: false,
  },
  memory: {
    enabled: true,
    mode: 'readonly',
  },
  anomaly: {
    enabled: true,
    failureRepeatThreshold: 3,
    toolLoopRepeatThreshold: 3,
    readRepeatThreshold: 3,
    windowMs: 600_000,
    cacheHitDropRatio: 0.25,
    requestsPerMinute: 12,
    contextPressureRatio: 0.85,
    alertCooldownMs: 60_000,
  },
  orchestration: {
    enabled: true,
    maxConcurrentSubagents: 3,
    dedupeWindowMs: 1_800_000,
  },
  server: {
    enabled: true,
    dashboard: true,
    allowConfigWrite: true,
  },
  retention: {
    ledgerDays: 90,
    spillDays: 14,
    checkpointDays: 30,
    logDays: 14,
  },
})

const ENUMS = {
  mode: ['audit', 'enforce'],
}
const NUMERIC = [
  ['budgets.perTaskUSD', 0, 1_000],
  ['budgets.perAgentUSD', 0, 1_000],
  ['budgets.dailyUSD', 0, 10_000],
  ['budgets.projectUSD', 0, 100_000],
  ['budgets.warnRatio', 0.1, 1],
  ['contextPacking.maxHistoryTurns', 1, 20],
  ['context.defaultBudgetTokens', 1_000, 2_000_000],
  ['context.hardBudgetTokens', 1_000, 4_000_000],
  ['context.warnRatio', 0.1, 1],
  ['prompt.duplicateMinChars', 40, 100_000],
  ['toolResult.maxChars', 500, 500_000],
  ['toolResult.headChars', 100, 200_000],
  ['toolResult.tailChars', 100, 200_000],
  ['toolResult.dedupeWindow', 0, 64],
  ['checkpoint.intervalMs', 5_000, 3_600_000],
  ['checkpoint.maxPerSession', 1, 500],
  ['anomaly.failureRepeatThreshold', 2, 20],
  ['anomaly.toolLoopRepeatThreshold', 2, 20],
  ['anomaly.readRepeatThreshold', 2, 20],
  ['anomaly.windowMs', 10_000, 86_400_000],
  ['anomaly.cacheHitDropRatio', 0.05, 0.95],
  ['anomaly.requestsPerMinute', 2, 600],
  ['anomaly.contextPressureRatio', 0.3, 1],
  ['anomaly.alertCooldownMs', 1_000, 3_600_000],
  ['orchestration.maxConcurrentSubagents', 1, 32],
  ['orchestration.dedupeWindowMs', 10_000, 86_400_000],
  ['retention.ledgerDays', 1, 3_650],
  ['retention.spillDays', 1, 365],
  ['retention.checkpointDays', 1, 3_650],
  ['retention.logDays', 1, 365],
]

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deep-merge `patch` over `base`, returning a new object; unknown keys are dropped. */
export function mergeConfig(base, patch) {
  const out = clone(base)
  if (!isPlainObject(patch)) return out
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in out)) continue
    if (isPlainObject(out[key]) && isPlainObject(value)) out[key] = mergeConfig(out[key], value)
    else if (typeof out[key] === typeof value) out[key] = value
  }
  return out
}

export function validateConfig(config) {
  const errors = []
  const fixed = mergeConfig(DEFAULT_CONFIG, config)
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(getPath(fixed, key))) {
      errors.push(`${key} must be one of ${allowed.join('|')}`)
      setPath(fixed, key, getPath(DEFAULT_CONFIG, key))
    }
  }
  if (typeof fixed.taskInstructions.text !== 'string' || fixed.taskInstructions.text.length > MAX_TASK_INSTRUCTIONS_CHARS) {
    errors.push(`taskInstructions.text must be a string of at most ${MAX_TASK_INSTRUCTIONS_CHARS} characters`)
    fixed.taskInstructions.text = DEFAULT_TASK_INSTRUCTIONS_TEXT
  }
  for (const [key, min, max] of NUMERIC) {
    const value = getPath(fixed, key)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
      || (key === 'contextPacking.maxHistoryTurns' && !Number.isSafeInteger(value))) {
      errors.push(`${key} must be a number in [${min}, ${max}]`)
      setPath(fixed, key, getPath(DEFAULT_CONFIG, key))
    }
  }
  return { config: fixed, errors }
}

export function getPath(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => (isPlainObject(value) ? value[key] : undefined), object)
}

export function setPath(object, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = object
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts.at(-1)] = value
  return object
}

/**
 * Persistent config store. `set` validates before writing so a bad UI edit can
 * never leave DSH with an unrunnable plugin config.
 */
export function createConfigStore(options) {
  const { file, log, defaultOverrides } = options
  const listeners = new Set()
  const loaded = validateConfig(mergeConfig(mergeConfig(DEFAULT_CONFIG, defaultOverrides ?? {}), readJson(file, {})))
  let current = loaded.config

  function persist() {
    writeJson(file, current)
  }

  function emit() {
    for (const listener of listeners) {
      try { listener(current) } catch (error) { log?.warn('config listener failed', error) }
    }
  }

  if (loaded.errors.length) log?.warn('config normalized', loaded.errors)
  try { persist() } catch (error) { log?.error('config persist failed', error) }

  return {
    file,
    all: () => current,
    get: (keyPath) => getPath(current, keyPath),
    /** Set one dot-path; returns {ok, errors}. */
    set(keyPath, value) {
      const candidate = clone(current)
      setPath(candidate, keyPath, value)
      const { config, errors } = validateConfig(candidate)
      if (errors.length) return { ok: false, errors }
      current = config
      try { persist() } catch (error) { log?.error('config write failed', error) }
      emit()
      return { ok: true }
    },
    update(patch) {
      const { config, errors } = validateConfig(mergeConfig(current, patch))
      if (errors.length) return { ok: false, errors }
      current = config
      try { persist() } catch (error) { log?.error('config write failed', error) }
      emit()
      return { ok: true }
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => clone(current),
  }
}
