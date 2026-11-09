/**
 * System-prompt audit ("Prompt Audit").
 *
 * The Host's assembly waterfall hands us the exact presentation that is about
 * to become the model's system prompt: sections (ordered blocks) plus dynamic
 * contexts. We measure every block, group byte-identical blocks, and — only when
 * the owner flips `prompt.trimDuplicates` *and* the plugin runs in `enforce`
 * mode — collapse an exact duplicate that appears in more than one section.
 *
 * Nothing here can remove a unique rule: only identical text, and only one copy
 * of it, ever leaves. Audit mode (the default) rewrites nothing.
 */
import path from 'node:path'
import { readJson, writeJson } from './store.js'
import { dayKey } from './paths.js'

const TOKENS_PER_CHAR = 1 / 3.6

function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length * TOKENS_PER_CHAR)
}

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function sectionName(section, index) {
  return String(section?.name ?? `section-${index}`)
}

export function createPromptAudit(core) {
  const { paths, log, config, ledger, anomaly, now } = core
  const snapshotFile = path.join(paths.root, 'state', 'prompt.json')
  const state = readJson(snapshotFile, { latest: null, history: [], totals: { assemblies: 0 } })
  if (!Array.isArray(state.history)) state.history = []

  function persist() {
    try { writeJson(snapshotFile, state) } catch (error) { log?.error('prompt snapshot write failed', error) }
  }

  function analyze(assembly) {
    const sections = Array.isArray(assembly?.sections) ? assembly.sections : []
    const contexts = Array.isArray(assembly?.contexts) ? assembly.contexts : []
    const seen = new Map()
    const duplicates = []
    const measured = sections.map((section, index) => {
      const name = sectionName(section, index)
      const chars = String(section?.text ?? '').length
      const normalized = normalize(section?.text)
      if (normalized.length >= config.get('prompt.duplicateMinChars')) {
        const prior = seen.get(normalized)
        if (prior) duplicates.push({ chars, names: [prior, name] })
        else seen.set(normalized, name)
      }
      return { name, chars, tokens: estimateTokens(section?.text) }
    })
    const contextBytes = contexts.map((context, index) => ({
      name: String(context?.name ?? `context-${index}`),
      chars: String(context?.text ?? '').length,
      tokens: estimateTokens(context?.text),
    }))
    const totalChars = measured.reduce((sum, item) => sum + item.chars, 0) + contextBytes.reduce((sum, item) => sum + item.chars, 0)
    return {
      at: now().toISOString(),
      day: dayKey(now()),
      totalChars,
      totalTokensEst: Math.ceil(totalChars * TOKENS_PER_CHAR),
      sectionCount: measured.length,
      toolCount: Array.isArray(assembly?.tools) ? assembly.tools.length : 0,
      sections: measured.sort((a, b) => b.tokens - a.tokens).slice(0, 40),
      contexts: contextBytes.sort((a, b) => b.tokens - a.tokens).slice(0, 12),
      duplicates,
    }
  }

  function trim(assembly, duplicates) {
    if (!duplicates.length) return { assembly, removedChars: 0, trimmed: 0 }
    const seen = new Set()
    let removedChars = 0
    let trimmed = 0
    const sections = []
    for (const section of assembly.sections ?? []) {
      const normalized = normalize(section?.text)
      if (normalized.length >= config.get('prompt.duplicateMinChars') && seen.has(normalized)) {
        removedChars += String(section?.text ?? '').length
        trimmed += 1
        continue
      }
      if (normalized.length >= config.get('prompt.duplicateMinChars')) seen.add(normalized)
      sections.push(section)
    }
    return { assembly: { ...assembly, sections }, removedChars, trimmed }
  }

  function process(assembly) {
    const report = analyze(assembly)
    state.totals.assemblies += 1
    state.latest = report
    state.history = [...state.history.slice(-4), {
      at: report.at,
      totalTokensEst: report.totalTokensEst,
      sectionCount: report.sectionCount,
      duplicates: report.duplicates.length,
    }]
    persist()

    const budget = config.get('context.defaultBudgetTokens')
    if (report.totalTokensEst > budget) {
      anomaly?.alert('prompt-budget', {
        sessionId: 'system-prompt',
        key: 'budget',
        severity: 'info',
        message: `系统提示词约 ${report.totalTokensEst} tokens，超出预算 ${budget}`,
        data: { tokensEst: report.totalTokensEst, budget, duplicates: report.duplicates.length },
      })
    }

    const shouldTrim = config.get('mode') === 'enforce' && config.get('prompt.trimDuplicates')
    if (!shouldTrim || !report.duplicates.length) return assembly
    const result = trim(assembly, report.duplicates)
    if (result.removedChars > 0) {
      ledger?.note('promptCharsRemoved', result.removedChars)
      ledger?.note('promptSectionsTrimmed', result.trimmed)
      state.latest = { ...report, trimmedSections: result.trimmed, removedChars: result.removedChars }
      persist()
    }
    return result.assembly
  }

  function attach(ctx) {
    const dispose = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      let output
      try {
        output = await next()
      } catch {
        return assembly
      }
      try {
        return process(output) ?? output
      } catch (error) {
        log?.error('prompt audit failed', error)
        return output
      }
    })
    return () => { try { dispose?.() } catch { /* ignore */ } ; persist() }
  }

  return {
    attach,
    process,
    analyze,
    latest: () => state.latest,
    totals: () => state.totals,
    snapshot: () => ({ latest: state.latest, history: state.history, totals: state.totals }),
    dispose: persist,
  }
}
