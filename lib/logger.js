/**
 * Bounded, append-only logger.
 *
 * A monitoring plugin must stay silent and cheap: no throw paths, no unbounded
 * growth, and never a reason to fail the Host. Records go to
 * `<state>/logs/optimizer.log`, rotated once past ~2 MB.
 */
import fs from 'node:fs'
import path from 'node:path'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_BYTES = 2 * 1024 * 1024

export function createLogger(options = {}) {
  const { file, level = 'info', echo = false } = options
  const threshold = LEVELS[level] ?? LEVELS.info
  let broken = false

  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_BYTES) fs.renameSync(file, `${file}.1`)
    } catch { /* missing file is normal */ }
  }

  function write(levelName, message, detail) {
    if (broken) return
    if ((LEVELS[levelName] ?? 0) < threshold) return
    const line = `${new Date().toISOString()} ${levelName.toUpperCase()} ${message}${
      detail === undefined ? '' : ` ${safeDetail(detail)}`
    }\n`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      rotateIfNeeded()
      fs.appendFileSync(file, line)
    } catch {
      broken = true
    }
    if (echo) {
      const sink = levelName === 'error' || levelName === 'warn' ? process.stderr : process.stdout
      try { sink.write(`[dsh-optimizer] ${message}\n`) } catch { /* ignore */ }
    }
  }

  return {
    file,
    debug: (message, detail) => write('debug', message, detail),
    info: (message, detail) => write('info', message, detail),
    warn: (message, detail) => write('warn', message, detail),
    error: (message, detail) => write('error', message, detail),
  }
}

function safeDetail(detail) {
  if (detail instanceof Error) return JSON.stringify({ name: detail.name, message: detail.message, stack: detail.stack?.split('\n').slice(0, 4).join(' | ') })
  try {
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
    return text.length > 800 ? `${text.slice(0, 800)}…` : text
  } catch {
    return String(detail)
  }
}
