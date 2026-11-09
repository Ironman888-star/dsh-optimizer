/**
 * Tool-result manager.
 *
 * A tool result is the cheapest thing to shrink and the most expensive thing to
 * lose: a 200 KB log can cost more than the task itself, but it may also hold
 * the only copy of an error line. So the rule here is:
 *
 *   1. never trim a failed result (unless the owner disables that guard);
 *   2. always persist the full text before trimming (`spill/<id>.txt`);
 *   3. keep head + tail so error lines near either edge survive;
 *   4. replace repeated identical payloads with a pointer to the first copy;
 *   5. in `audit` mode only measure — the model still sees everything.
 *
 * The model can always re-read the spilled file with its own file tools; the
 * marker includes the absolute path.
 */
import fs from 'node:fs'
import path from 'node:path'
import { appendJsonl, listFiles, readJson, writeJson } from './store.js'
import { dayKey, spillFile } from './paths.js'

const TEXT_TOKENS_PER_CHAR = 1 / 3.6

function hashText(text) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function flattenText(blocks) {
  if (!Array.isArray(blocks)) return { text: '', textBlocks: [] }
  const textBlocks = blocks.filter((block) => block && block.type === 'text' && typeof block.text === 'string')
  return { text: textBlocks.map((block) => block.text).join('\n'), textBlocks }
}

function sessionIdOf(exec) {
  const session = exec?.agent?.session
  if (session && typeof session.id === 'string') return session.id
  return 'unknown'
}

export function createToolResult(core) {
  const { paths, log, config, ledger, now } = core
  const statsFile = path.join(paths.root, 'state', 'tool-result.json')
  const stats = Object.assign({ pruned: 0, deduped: 0, savedChars: 0, savedTokensEst: 0, opportunities: 0, opportunityChars: 0, lastAt: null }, readJson(statsFile, {}))
  const seen = new Map()

  const indexPath = path.join(paths.root, 'state', 'spill-index.jsonl')

  function flushStats() {
    try { writeJson(statsFile, stats) } catch (error) { log?.error('tool-result stats write failed', error) }
  }

  function spill(id, text, meta) {
    const file = spillFile(paths.root, id)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
      appendJsonl(indexPath, [{ v: 1, id, file, chars: text.length, ts: now().toISOString(), ...meta }])
      return file
    } catch (error) {
      log?.error('spill write failed', error)
      return null
    }
  }

  function retention() {
    const keepDays = config.get('retention.spillDays')
    const cutoff = now().getTime() - keepDays * 86_400_000
    for (const file of listFiles(path.join(paths.root, 'spill'))) {
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
      } catch { /* ignore */ }
    }
  }

  function marker(file, removedChars, totalChars) {
    return `\n\n…[dsh-optimizer 已精简 ${removedChars} 字符 / 原始 ${totalChars} 字符。完整输出已保存，可直接读取：${file}]\n\n`
  }

  function shape(exec, result) {
    const settings = config.get('toolResult')
    const mode = config.get('mode')
    const enabled = config.get('enabled') && settings.enabled
    const sessionId = sessionIdOf(exec)
    const tool = String(exec?.name ?? 'tool')
    if (!enabled || !result) return null

    const { text } = flattenText(result.content)
    if (!text) return null
    const chars = text.length
    const failed = result.isError === true || Boolean(result.error)
    if (failed && settings.keepErrorsIntact) return null

    // dedupe: identical payloads inside a small window. Audit never rewrites what
    // the model sees, so it only books the opportunity.
    let list = seen.get(sessionId)
    if (!list) { list = []; seen.set(sessionId, list) }
    const hash = hashText(text)
    const previous = list.find((entry) => entry.hash === hash)
    if (previous && chars > 400) {
      if (mode !== 'enforce') {
        stats.opportunities += 1
        stats.opportunityChars += chars
        stats.lastAt = now().toISOString()
        flushStats()
        return null
      }
      stats.deduped += 1
      stats.savedChars += chars
      stats.savedTokensEst += Math.round(chars * TEXT_TOKENS_PER_CHAR)
      stats.lastAt = now().toISOString()
      ledger?.note('toolResultsDeduped')
      ledger?.note('toolCharsPruned', chars)
      flushStats()
      const where = previous.file
        ? `完整内容：${previous.file}`
        : '首次出现的完整内容仍在本会话上文中，可直接引用'
      return {
        kind: 'accept',
        content: [{
          type: 'text',
          text: `[dsh-optimizer] 该结果与本次会话中 ${previous.at} 的 ${tool} 输出完全一致，已省略 ${chars} 字符。${where}`,
        }],
      }
    }

    if (chars <= settings.maxChars) {
      list.push({ hash, at: now().toISOString(), file: null })
      if (list.length > 32) list.shift()
      return null
    }

    if (mode !== 'enforce') {
      // Audit: record the opportunity (what enforce mode *would* have saved) so
      // the first-batch report can quantify gains without changing model input.
      const shrinkable = chars - settings.maxChars
      if (shrinkable > 0) {
        stats.opportunities += 1
        stats.opportunityChars += shrinkable
        stats.lastAt = now().toISOString()
        flushStats()
      }
      return null
    }

    const head = text.slice(0, settings.headChars)
    const tail = text.slice(Math.max(settings.headChars, text.length - settings.tailChars))
    const removed = chars - head.length - tail.length
    const id = `${dayKey(now())}_${hash}_${tool.replace(/[^a-zA-Z0-9_-]+/g, '')}`.slice(0, 100)
    const file = spill(id, text, { tool, sessionId })
    if (!file) return null
    const content = [{ type: 'text', text: `${head}\n\n…[dsh-optimizer 已精简 ${removed} 字符 / 原始 ${chars} 字符。完整输出已保存，可直接读取：${file}]\n\n${tail}` }]

    stats.pruned += 1
    stats.savedChars += removed
    stats.savedTokensEst += Math.round(removed * TEXT_TOKENS_PER_CHAR)
    stats.lastAt = now().toISOString()
    ledger?.note('toolResultsPruned')
    ledger?.note('toolCharsPruned', removed)
    flushStats()
    list.push({ hash, at: now().toISOString(), file })
    if (list.length > 32) list.shift()
    if (stats.pruned % 20 === 0) retention()
    return { kind: 'accept', content }
  }

  function attach(ctx) {
    const dispose = ctx.on('tools/post-execute', async (exec, result, next) => {
      let base
      try {
        base = await next()
      } catch {
        base = { kind: 'accept' }
      }
      try {
        const decision = shape(exec, result)
        if (decision && base?.kind !== 'block') return decision
        return base
      } catch (error) {
        log?.error('tool-result shaping failed', error)
        return base
      }
    })
    return () => { try { dispose?.() } catch { /* ignore */ } ; flushStats() }
  }

  return {
    attach,
    shape,
    stats: () => ({ ...stats }),
    dispose: flushStats,
  }
}
