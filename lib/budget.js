/**
 * Budgets and spending gates.
 *
 * Four scopes from the directive: per task, per agent, per day, per project.
 * The plugin never hard-kills a turn — it records a warning, raises an anomaly,
 * and (only in `enforce` mode) marks itself as paused for new optional work so
 * the owner can approve a larger budget. Current tasks are left alone: stopping
 * a half-written file is worse than overspending a few cents.
 */
import path from 'node:path'
import { readJson, writeJson } from './store.js'
import { dayKey } from './paths.js'

export function createBudget(core) {
  const { paths, log, config, ledger, anomaly, now } = core
  const stateFile = path.join(paths.root, 'state', 'budget.json')
  const state = Object.assign({ paused: false, pausedAt: null, reason: null, warned: {} }, readJson(stateFile, {}))

  function persist() {
    try { writeJson(stateFile, state) } catch (error) { log?.error('budget state write failed', error) }
  }

  function scope(used, limit) {
    const ratio = limit > 0 ? used / limit : 0
    return {
      usedUSD: Number(used.toFixed(6)),
      limitUSD: limit,
      ratio: Number(ratio.toFixed(4)),
      remainingUSD: Number(Math.max(0, limit - used).toFixed(6)),
      state: ratio >= 1 ? 'over' : ratio >= config.get('budgets.warnRatio') ? 'warn' : 'ok',
    }
  }

  function status() {
    const day = dayKey(now())
    const today = ledger.state.days[day] ?? {}
    const project = ledger.state.project ?? {}
    const agents = Object.entries(ledger.state.agents)
      .map(([id, totals]) => ({ id, ...scope(totals.costUSD ?? 0, config.get('budgets.perAgentUSD')) }))
      .sort((a, b) => b.usedUSD - a.usedUSD)
      .slice(0, 10)
    const tasks = Object.entries(ledger.state.tasks)
      .map(([id, totals]) => ({ id, ...scope(totals.costUSD ?? 0, config.get('budgets.perTaskUSD')) }))
      .sort((a, b) => b.usedUSD - a.usedUSD)
      .slice(0, 10)
    return {
      paused: state.paused,
      pausedAt: state.pausedAt,
      reason: state.reason,
      scopes: {
        day: scope(today.costUSD ?? 0, config.get('budgets.dailyUSD')),
        project: scope(project.costUSD ?? 0, config.get('budgets.projectUSD')),
        agents,
        tasks,
      },
    }
  }

  function check() {
    const result = status()
    const warn = config.get('budgets.warnRatio')
    for (const [name, entry] of Object.entries({ day: result.scopes.day, project: result.scopes.project })) {
      if (entry.ratio >= 1) {
        if (!state.paused) {
          state.paused = config.get('mode') === 'enforce'
          state.pausedAt = now().toISOString()
          state.reason = `${name} 预算已用尽（$${entry.usedUSD} / $${entry.limitUSD}）`
          persist()
        }
        anomaly?.alert('budget', {
          sessionId: 'budget',
          key: name,
          severity: 'critical',
          message: state.reason,
          data: entry,
        })
      } else if (entry.ratio >= warn && state.warned[`${name}:${dayKey(now())}`] !== true) {
        state.warned[`${name}:${dayKey(now())}`] = true
        persist()
        ledger?.note('budgetWarnings')
        anomaly?.alert('budget', {
          sessionId: 'budget',
          key: name,
          severity: 'warn',
          message: `${name} 预算已达到 ${(entry.ratio * 100).toFixed(0)}%（$${entry.usedUSD} / $${entry.limitUSD}）`,
          data: entry,
        })
      }
    }
    return result
  }

  function attach() {
    const dispose = ledger.onChange(() => {
      try { check() } catch (error) { log?.error('budget check failed', error) }
    })
    return () => { try { dispose?.() } catch { /* ignore */ } ; persist() }
  }

  function unpause() {
    state.paused = false
    state.pausedAt = null
    state.reason = null
    persist()
    return status()
  }

  return {
    attach,
    status,
    check,
    pause: (reason) => { state.paused = true; state.pausedAt = now().toISOString(); state.reason = reason ?? '手动暂停'; persist(); return status() },
    resume: unpause,
    gate: () => ({ paused: state.paused, reason: state.reason }),
  }
}
