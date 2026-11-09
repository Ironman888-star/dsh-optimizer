/**
 * Filesystem layout for the optimizer.
 *
 * Everything the plugin persists lives under
 * `<DSH_HOME>/storages/dsh-optimizer/` so a profile backup or a rollback can
 * capture it in one directory. The location is overridable through
 * `config.stateDir` (absolute path) — the Host resolves it once at boot.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PLUGIN_ID = 'dsh-optimizer'

/** Subdirectories created on boot, in creation order. */
export const SUBDIRS = ['ledger', 'checkpoints', 'spill', 'reports', 'logs', 'state', 'tmp']

/** Resolve the state root, honouring an explicit override. */
export function resolveStateRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(configured.trim())
  }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', PLUGIN_ID)
}

/** Create the directory layout; idempotent. Returns diagnostic info instead of throwing. */
export function ensureLayout(root) {
  const created = []
  const existed = []
  fs.mkdirSync(root, { recursive: true })
  for (const sub of SUBDIRS) {
    const dir = path.join(root, sub)
    if (fs.existsSync(dir)) existed.push(sub)
    else { fs.mkdirSync(dir, { recursive: true }); created.push(sub) }
  }
  return { root, created, existed }
}

/** True when `child` is inside `parent` (both resolved), used to fence file reads. */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  if (rel === '' || path.isAbsolute(rel)) return false
  // Compare per segment: '.._notes.json' is a legal file name, '..' is not.
  return rel !== '..' && !rel.startsWith(`..${path.sep}`)
}

const DAY_FORMATTERS = new Map()

/** `YYYY-MM-DD` for a timestamp in the given IANA time zone (default Asia/Shanghai). */
export function dayKey(date = new Date(), timeZone = 'Asia/Shanghai') {
  let formatter = DAY_FORMATTERS.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    DAY_FORMATTERS.set(timeZone, formatter)
  }
  return formatter.format(date)
}

/** Filesystem-safe UTC stamp for artifact names. */
export function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

export function ledgerFile(root, day) {
  return path.join(root, 'ledger', `${day}.jsonl`)
}

export function spillFile(root, id) {
  return path.join(root, 'spill', `${id}.txt`)
}

export function checkpointFile(root, taskId) {
  return path.join(root, 'checkpoints', `${sanitizeId(taskId)}.json`)
}

export function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'unknown'
}
