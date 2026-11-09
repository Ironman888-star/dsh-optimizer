/**
 * Loopback HTTP surface.
 *
 * Same fencing rules as the balance peek plugin: loopback-only, same-origin,
 * no cross-site fetches, GET/HEAD except one POST for explicit local actions,
 * and we defer to the Host's own connection fence when it provides one. The
 * routes serve aggregates only — never session text, credentials, or the full
 * spilled tool output (a spill file is served by explicit name, from inside the
 * spill directory, and only to a same-origin loopback caller).
 */
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { dashboardHtml } from './dashboard.js'
import { isInside } from './paths.js'

const BASE = '/dsh-optimizer'
const MAX_BODY = 64 * 1024
const MAX_SPILL = 2 * 1024 * 1024
const CONTROL_TTL_MS = 2 * 60_000
const MAX_CONTROL_TOKENS = 32
const OWNER_ACTIONS = new Set(['setPackingConfig', 'setTaskInstructions'])

function getHeader(req, name) {
  const headers = req?.headers
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  return headers[name] ?? headers[name.toLowerCase()]
}

function hostnameOf(hostHeader) {
  if (!hostHeader) return ''
  const text = String(hostHeader).trim()
  if (text.startsWith('[')) {
    const end = text.indexOf(']')
    return end > 0 ? text.slice(1, end) : text
  }
  return text.split(':')[0]
}

function isLoopbackHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase()
  return host === 'localhost' || host === '::1' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host)
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const base = {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, base)
    res.end(payload)
  }
}

function sendJson(res, status, body) {
  send(res, status, body, { 'content-type': 'application/json; charset=utf-8' })
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Reject anything that is not a same-origin loopback request. Returns a status or null. */
function fence(req, options, log) {
  const method = String(req?.method ?? 'GET').toUpperCase()
  const allowed = options.methods ?? ['GET', 'HEAD']
  if (!allowed.includes(method)) return 405
  const host = getHeader(req, 'host')
  const hostname = hostnameOf(host)
  if (!isLoopbackHostname(hostname)) return 403
  if (String(getHeader(req, 'sec-fetch-site') ?? '') === 'cross-site') return 403
  const origin = getHeader(req, 'origin')
  if (origin) {
    try {
      const originUrl = new URL(String(origin))
      const originHost = originUrl.host
      if (host && originHost !== String(host)) return 403
      if (!isLoopbackHostname(hostnameOf(originHost))) return 403
    } catch {
      return 403
    }
  }
  // `ctx.get(name)` throws when `name` was not injected into this scope, so the
  // optional host fence lookup must never propagate that error.
  let connection = null
  try { connection = options.getService?.('connection') ?? null } catch { connection = null }
  try {
    const rejection = connection?.requestRejection?.(req)
    if (typeof rejection === 'string' && rejection) {
      log?.warn('route rejected by host fence', rejection)
      return 403
    }
  } catch { /* optional service */ }
  return null
}

export function createServer({ core, host, log }) {
  let mounted = false
  /** Host `connection` service, resolved through a nested `inject` scope. */
  let connection = null
  const uiTokens = new Map()

  function issueUiToken() {
    const now = Date.now()
    for (const [token, expiry] of uiTokens) if (expiry <= now) uiTokens.delete(token)
    while (uiTokens.size >= MAX_CONTROL_TOKENS) uiTokens.delete(uiTokens.keys().next().value)
    const token = randomBytes(32).toString('hex')
    uiTokens.set(token, now + CONTROL_TTL_MS)
    return token
  }

  function consumeUiToken(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false
    const expiry = uiTokens.get(value)
    uiTokens.delete(value) // single-use even if invalid or expired
    return Number.isFinite(expiry) && expiry > Date.now()
  }

  function route(ctx, path_, handler, options = {}) {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}${path_}`,
      handler: (req, res) => {
        const respond = (value) => {
          if (options.html && typeof value === 'string') {
            send(res, 200, value, { 'content-type': 'text/html; charset=utf-8' })
            return
          }
          sendJson(res, 200, value)
        }
        try {
          const getService = (name) => {
            if (name !== 'connection') return undefined
            if (connection) return connection
            try { return ctx.get?.('connection') ?? null } catch { return null }
          }
          const status = fence(req, { ...options, getService }, log)
          if (status) { sendJson(res, status, { ok: false, error: status === 405 ? 'method not allowed' : 'forbidden' }); return }
          const result = handler(req, res)
          if (result && typeof result.then === 'function') {
            result.then(respond).catch((error) => {
              log?.error(`route ${path_} failed`, error)
              try { sendJson(res, 500, { ok: false, error: String(error?.message ?? error) }) } catch { /* ignore */ }
            })
          } else {
            respond(result)
          }
        } catch (error) {
          log?.error(`route ${path_} threw`, error)
          try { sendJson(res, 500, { ok: false, error: String(error?.message ?? error) }) } catch { /* ignore */ }
        }
      },
    })
    return dispose
  }

  function attach(ctx) {
    // The host fence lives in an optional `connection` service; resolve it via a
    // nested inject scope so this module still mounts without it.
    let scope = null
    try {
      if (typeof ctx.inject === 'function') scope = ctx.inject(['connection'], (scoped) => { connection = scoped.connection ?? null })
    } catch { connection = null }
    const disposers = []
    disposers.push(route(ctx, '/state.json', () => ({ ok: true, ...host.status() })))
    disposers.push(route(ctx, '/report.json', () => ({ ok: true, report: host.reportSnapshot() })))
    disposers.push(route(ctx, '/config.json', () => ({ ok: true, config: host.config.snapshot(), file: host.config.file })))
    disposers.push(route(ctx, '/dashboard', () => dashboardHtml({ base: BASE }), { html: true }))
    // Ephemeral, single-use UI action token. This is an anti-CSRF / accidental
    // call barrier, NOT an owner identity or protection from local arbitrary code.
    disposers.push(route(ctx, '/ui-control-token.json', () => ({ ok: true, token: issueUiToken() })))
    disposers.push(route(ctx, '/spill.json', (req) => {
      const url = new URL(String(req.url ?? '/'), 'http://localhost')
      const name = url.searchParams.get('name') ?? ''
      const file = path.join(host.paths.root, 'spill', path.basename(name))
      if (!name || !isInside(path.join(host.paths.root, 'spill'), file)) return { ok: false, error: 'invalid name' }
      try {
        const stat = fs.statSync(file)
        if (!stat.isFile() || stat.size > MAX_SPILL) return { ok: false, error: 'unavailable' }
        return { ok: true, name: path.basename(file), chars: stat.size, text: fs.readFileSync(file, 'utf8') }
      } catch {
        return { ok: false, error: 'not found' }
      }
    }))
    disposers.push(route(ctx, '/action.json', async (req) => {
      const body = await readBody(req)
      const parsed = body ? JSON.parse(body) : {}
      const action = String(parsed.action ?? parsed.name ?? '')
      const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed
      const writeActions = new Set(['setMode', 'setEnabled', 'setConfig', 'prune', 'setPackingConfig', 'setTaskInstructions'])
      if (writeActions.has(action) && !host.config.get('server.allowConfigWrite')) {
        return { ok: false, errors: ['配置写入已关闭（server.allowConfigWrite=false）'] }
      }
      if (OWNER_ACTIONS.has(action)) {
        if (!consumeUiToken(getHeader(req, 'x-dsh-optimizer-ui-token'))) {
          return { ok: false, errors: ['操作凭证无效或已过期，请从设置页重新操作'] }
        }
        return host.ownerControl(action, payload)
      }
      return host.actions(action, payload)
    }, { methods: ['POST'] }))
    mounted = true
    log?.info(`routes mounted: ${disposers.length} under ${BASE} (state/report/config/spill .json, dashboard, action)`)
    return () => {
      for (const dispose of disposers) { try { dispose?.() } catch { /* ignore */ } }
      try { scope?.() } catch { /* ignore */ }
      connection = null
      uiTokens.clear()
      mounted = false
    }
  }

  return {
    attach,
    isMounted: () => mounted,
    html: () => dashboardHtml({ base: BASE }),
  }
}
