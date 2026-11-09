/**
 * Pricing engine.
 *
 * Mirrors the catalog shipped in the desktop usage cache
 * (`storages/usage-stats-cache.json` → `pricingFingerprint.pricingCatalog`,
 * version 10, sampled 2026-11-06) so an estimate here and the desktop number
 * can be cross-checked. Prices are USD per 1M tokens and time-windowed; the
 * estimator always records which window it used (`pricingId`).
 *
 * Assumptions worth stating out loud:
 *  - `cacheWriteTokens` is billed at the input rate. The catalog does not
 *    publish a separate cache-write price.
 *  - Peak windows for the pre-2026-08-22 "time-band" entries are assumed to be
 *    the same weekday windows as the current schedule.
 *  - A token count is "total prompt tokens" when `inputTokens` is at least the
 *    sum of cache reads/writes; otherwise the source reports uncached input
 *    separately and we reconstruct the total.
 */

export const PRICING_VERSION = 'desktop-usage-stats-cache-v10@2026-11-06'
export const CURRENCY = 'USD'
export const UNIT = 1_000_000

const TZ = 'Asia/Shanghai'

const FLAT_FLASH = { input: 0.14, cacheRead: 0.0028, output: 0.28, cacheWrite: 0.14 }
const FLAT_PRO = { input: 0.435, cacheRead: 0.003625, output: 0.87, cacheWrite: 0.435 }
const BAND_FLASH = {
  offPeak: { input: 0.22, cacheRead: 0.007, output: 0.66, cacheWrite: 0.22 },
  peak: { input: 0.44, cacheRead: 0.014, output: 1.32, cacheWrite: 0.44 },
}
const BAND_PRO = {
  offPeak: { input: 0.66, cacheRead: 0.022, output: 1.98, cacheWrite: 0.66 },
  peak: { input: 1.32, cacheRead: 0.044, output: 3.96, cacheWrite: 1.32 },
}

/** Weekday minutes-of-day windows, ISO weekday numbers (Mon=1 … Sun=7). */
const SCHEDULE = {
  timeZone: TZ,
  peakDays: [1, 2, 3, 4, 5],
  peakWindows: [
    ['09:00', '12:00'],
    ['14:00', '18:00'],
  ],
}

const ENTRIES = [
  { id: 'flat-pre-2026-08-16', from: null, to: '2026-08-16T00:00:00+08:00', kind: 'flat', price: { 'deepseek-v4-flash': FLAT_FLASH, 'deepseek-v4-pro': FLAT_PRO } },
  { id: 'band-v1-2026-08-16..22', from: '2026-08-16T00:00:00+08:00', to: '2026-08-22T00:00:00+08:00', kind: 'band', price: { 'deepseek-v4-flash': BAND_FLASH, 'deepseek-v4-pro': BAND_PRO } },
  { id: 'schedule-v2-2026-08-22+', from: '2026-08-22T00:00:00+08:00', to: null, kind: 'schedule', price: { 'deepseek-v4-flash': BAND_FLASH, 'deepseek-v4-pro': BAND_PRO } },
]

export const FAMILIES = ['deepseek-v4-flash', 'deepseek-v4-pro']

const PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ISO_WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** Local weekday + minutes for an instant in Asia/Shanghai. */
export function localSchedulePoint(at = new Date()) {
  const parts = PARTS_FORMATTER.formatToParts(at)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const hour = Number(map.hour === '24' ? '0' : map.hour)
  const minute = Number(map.minute)
  return { weekday: ISO_WEEKDAY[map.weekday] ?? 0, minutes: hour * 60 + minute }
}

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** True when `at` falls in a weekday peak window. */
export function isPeak(at = new Date()) {
  const { weekday, minutes } = localSchedulePoint(at)
  if (!SCHEDULE.peakDays.includes(weekday)) return false
  return SCHEDULE.peakWindows.some(([start, end]) => minutes >= minutesOfDay(start) && minutes < minutesOfDay(end))
}

/** Normalize a provider/model pair to a pricing family. */
export function modelFamily(provider, model) {
  const text = `${model ?? ''} ${provider ?? ''}`.toLowerCase()
  if (text.includes('pro')) return 'deepseek-v4-pro'
  return 'deepseek-v4-flash'
}

function entryAt(at) {
  const time = at.getTime()
  let fallback = ENTRIES[0]
  for (const entry of ENTRIES) {
    const from = entry.from ? Date.parse(entry.from) : -Infinity
    const to = entry.to ? Date.parse(entry.to) : Infinity
    if (time >= from && time < to) return entry
    if (time >= from) fallback = entry
  }
  return fallback
}

/** Exact price used for one request. */
export function priceAt({ provider = 'deepseek-account', model = 'deepseek-flash', at = new Date() } = {}) {
  const entry = entryAt(at)
  const family = modelFamily(provider, model)
  const tier = entry.kind === 'flat' ? 'flat' : isPeak(at) ? 'peak' : 'offPeak'
  const price = entry.kind === 'flat' ? entry.price[family] : entry.price[family][tier]
  return {
    family,
    tier,
    pricingId: `${entry.id}:${tier}`,
    pricingVersion: PRICING_VERSION,
    currency: CURRENCY,
    unit: UNIT,
    input: price.input,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
    output: price.output,
  }
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Reconstruct the three billable buckets from a `TokenUsage`-shaped object.
 * `mode` records which interpretation was used.
 */
export function normalizeUsage(usage = {}) {
  const input = num(usage.inputTokens)
  const cacheRead = num(usage.cacheReadTokens ?? usage.cachedInputTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const output = num(usage.outputTokens)
  const reasoning = num(usage.reasoningTokens)
  const totalInput = input >= cacheRead + cacheWrite ? input : input + cacheRead + cacheWrite
  const uncached = input >= cacheRead + cacheWrite ? input - cacheRead - cacheWrite : input
  return {
    mode: input >= cacheRead + cacheWrite ? 'total' : 'uncached',
    totalInput,
    uncachedInputTokens: uncached,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: reasoning,
    cacheHitRate: totalInput > 0 ? cacheRead / totalInput : 0,
  }
}

/** USD cost for one normalized usage under one price. */
export function computeCost(usage, price) {
  const tokens = normalizeUsage(usage)
  const usd = (
    tokens.uncachedInputTokens * price.input +
    tokens.cachedInputTokens * price.cacheRead +
    tokens.cacheWriteTokens * price.cacheWrite +
    tokens.outputTokens * price.output
  ) / UNIT
  return {
    costUSD: Math.round(usd * 1e9) / 1e9,
    tokens,
  }
}

/** One call: usage + provider/model + instant → cost record fields. */
export function estimateRequest({ provider, model, usage, at = new Date() }) {
  const price = priceAt({ provider, model, at })
  const { costUSD, tokens } = computeCost(usage, price)
  return { price, tokens, costUSD }
}

export function catalogSnapshot() {
  return {
    pricingVersion: PRICING_VERSION,
    currency: CURRENCY,
    unit: UNIT,
    timeZone: TZ,
    schedule: SCHEDULE,
    entries: ENTRIES.map((entry) => ({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      kind: entry.kind,
      prices: entry.price,
    })),
  }
}
