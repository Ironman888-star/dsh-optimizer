import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PRICING_VERSION,
  priceAt,
  isPeak,
  modelFamily,
  normalizeUsage,
  computeCost,
  estimateRequest,
  catalogSnapshot,
} from '../lib/pricing.js'

const at = (iso) => new Date(iso)

test('pricing: flat era before 2026-08-16', () => {
  const price = priceAt({ at: at('2026-07-01T03:00:00Z') })
  assert.equal(price.pricingId, 'flat-pre-2026-08-16:flat')
  assert.equal(price.family, 'deepseek-v4-flash')
  assert.equal(price.input, 0.14)
  assert.equal(price.cacheRead, 0.0028)
  assert.equal(price.output, 0.28)
  assert.equal(price.pricingVersion, PRICING_VERSION)
})

test('pricing: pro family is detected from the model name', () => {
  assert.equal(modelFamily('deepseek-account', 'deepseek-pro'), 'deepseek-v4-pro')
  assert.equal(modelFamily('deepseek-account', 'deepseek-flash'), 'deepseek-v4-flash')
  const price = priceAt({ model: 'deepseek-pro', at: at('2026-07-01T03:00:00Z') })
  assert.equal(price.input, 0.435)
  assert.equal(price.output, 0.87)
})

test('pricing: time-band era 2026-08-16..22 has peak and off-peak', () => {
  // 2026-08-17 is a Monday; 10:00 in Asia/Shanghai is inside a peak window.
  const peak = priceAt({ at: at('2026-08-17T02:00:00Z') })
  assert.match(peak.pricingId, /^band-v1-2026-08-16\.\.22:peak$/)
  assert.equal(peak.input, 0.44)
  // 20:00 local is off-peak.
  const offPeak = priceAt({ at: at('2026-08-17T12:00:00Z') })
  assert.match(offPeak.pricingId, /:offPeak$/)
  assert.equal(offPeak.input, 0.22)
})

test('pricing: weekday schedule era selects peak by Asia/Shanghai clock', () => {
  const weekdayPeak = priceAt({ at: at('2026-09-02T02:00:00Z') }) // Wed 10:00 local
  assert.match(weekdayPeak.pricingId, /^schedule-v2-2026-08-22\+:peak$/)
  const weekdayNoon = priceAt({ at: at('2026-09-02T04:30:00Z') }) // Wed 12:30 local
  assert.match(weekdayNoon.pricingId, /:offPeak$/)
  const saturday = priceAt({ at: at('2026-09-05T02:00:00Z') }) // Sat 10:00 local
  assert.match(saturday.pricingId, /:offPeak$/)
  assert.equal(isPeak(at('2026-09-02T02:00:00Z')), true)
  assert.equal(isPeak(at('2026-09-05T02:00:00Z')), false)
})

test('pricing: normalizeUsage distinguishes total-input and uncached-input providers', () => {
  const total = normalizeUsage({ inputTokens: 10_000, cacheReadTokens: 8_000, outputTokens: 500 })
  assert.equal(total.mode, 'total')
  assert.equal(total.totalInput, 10_000)
  assert.equal(total.uncachedInputTokens, 2_000)
  assert.equal(total.cachedInputTokens, 8_000)
  assert.equal(total.cacheHitRate, 0.8)

  const uncached = normalizeUsage({ inputTokens: 2_000, cacheReadTokens: 8_000, outputTokens: 500 })
  assert.equal(uncached.mode, 'uncached')
  assert.equal(uncached.totalInput, 10_000)
  assert.equal(uncached.uncachedInputTokens, 2_000)
  assert.equal(uncached.cacheHitRate, 0.8)
})

test('pricing: cache reads are ~31x cheaper than uncached input', () => {
  const offPeak = { input: 0.22, cacheRead: 0.007, cacheWrite: 0.22, output: 0.66 }
  const { costUSD } = computeCost({ inputTokens: 1_000_000, outputTokens: 0 }, offPeak)
  assert.equal(costUSD, 0.22)
  const cached = computeCost({ inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 }, offPeak)
  assert.equal(cached.costUSD, 0.007)
  assert.ok(costUSD / cached.costUSD > 31)
})

test('pricing: estimateRequest returns price, buckets and cost together', () => {
  const result = estimateRequest({
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    usage: { inputTokens: 10_000, cacheReadTokens: 8_000, outputTokens: 500 },
    at: at('2026-09-05T12:00:00Z'), // Saturday, off-peak
  })
  assert.equal(result.tokens.cachedInputTokens, 8_000)
  assert.equal(result.price.tier, 'offPeak')
  // 2000*0.22 + 8000*0.007 + 500*0.66 = 440 + 56 + 330 = 826 / 1e6
  assert.equal(result.costUSD, Math.round(0.000826 * 1e9) / 1e9)
})

test('pricing: catalogSnapshot is self-describing and versioned', () => {
  const snapshot = catalogSnapshot()
  assert.equal(snapshot.pricingVersion, PRICING_VERSION)
  assert.equal(snapshot.unit, 1_000_000)
  assert.equal(snapshot.schedule.timeZone, 'Asia/Shanghai')
  assert.deepEqual(snapshot.schedule.peakDays, [1, 2, 3, 4, 5])
  assert.ok(snapshot.entries.length >= 3)
  for (const entry of snapshot.entries) {
    assert.ok(entry.id)
    assert.ok('from' in entry)
  }
})
