/**
 * Small persistence helpers: atomic JSON writes, JSONL append/read, retention.
 *
 * The optimizer must never corrupt its own bookkeeping when DSH is killed
 * mid-write, so every whole-file update goes through a temp file + rename.
 */
import fs from 'node:fs'
import path from 'node:path'

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value))
  try {
    fs.renameSync(tmp, file)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw error
  }
}

export function appendJsonl(file, records) {
  if (!records.length) return 0
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  fs.appendFileSync(file, text)
  return text.length
}

/** Read a JSONL file; malformed lines are skipped (a killed append may truncate one). */
export function readJsonl(file, options = {}) {
  const { limit = 0 } = options
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n')
  const out = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch { /* skip truncated tail line */ }
  }
  return limit > 0 ? out.slice(-limit) : out
}

export function listFiles(dir, filter) {
  try {
    return fs.readdirSync(dir).filter((name) => (filter ? filter(name) : true)).map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

/** Delete files older than `keepDays` whose names start with a `YYYY-MM-DD` day key. */
export function pruneDailyFiles(dir, keepDays, now = new Date()) {
  const removed = []
  const cutoff = now.getTime() - Math.max(1, keepDays) * 86_400_000
  for (const file of listFiles(dir, (name) => /^\d{4}-\d{2}-\d{2}\./.test(name))) {
    const day = path.basename(file).slice(0, 10)
    const time = Date.parse(`${day}T00:00:00Z`)
    if (Number.isFinite(time) && time < cutoff) {
      try { fs.unlinkSync(file); removed.push(file) } catch { /* ignore */ }
    }
  }
  return removed
}

/** Keep only the newest `keep` files in a directory (by mtime). */
export function pruneNewest(dir, keep) {
  const entries = []
  for (const file of listFiles(dir)) {
    try { entries.push({ file, mtime: fs.statSync(file).mtimeMs }) } catch { /* ignore */ }
  }
  entries.sort((a, b) => b.mtime - a.mtime)
  const removed = []
  for (const entry of entries.slice(Math.max(0, keep))) {
    try { fs.unlinkSync(entry.file); removed.push(entry.file) } catch { /* ignore */ }
  }
  return removed
}
