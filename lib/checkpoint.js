/**
 * Checkpoint manager.
 *
 * A checkpoint is a *durable description of where a task stands*, written after
 * turn boundaries (and on a timer while a turn is running). It deliberately
 * records **pending side effects** rather than trying to replay them: on
 * restart the safe move is "read the checkpoint, look at the workspace, then
 * decide", never "re-run the last tool call". Sending a QQ message or
 * re-installing a plugin twice is exactly what we are protecting against.
 *
 * Writes go to `<state>/checkpoints/<taskId>.json` plus a bounded index at
 * `<state>/checkpoints.json` for the UI, so recovery can find the latest state
 * even if the session log is huge.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJson } from './store.js'
import { checkpointFile, sanitizeId } from './paths.js'

const DESTRUCTIVE_SHELL = /(\brm\b|\bdel\b|\brmdir\b|Remove-Item|rmtree|format\s|diskpart|git\s+push|npm\s+publish|pnpm\s+publish|pip\s+install|npm\s+i(nstall)?\s+-g|Set-Content|Out-File|>\s*\S+|drop\s+table|delete\s+from|truncate\s+table)/i
const EXTERNAL_TOOLS = /(qq|astrbot|snowluma|bilibili|b站|comment|send_message|sendMessage|onebot|napcat)/i

/** Classify one tool call by the side effect it can leave behind. */
export function classifySideEffect(name, args) {
  const tool = String(name ?? '')
  const text = safeJson(args)
  if (tool === 'write' || tool === 'edit' || tool === 'write_text' || tool === 'edit_text') {
    return { risk: 'workspace-write', label: `写文件：${extractPath(args) ?? '未知路径'}` }
  }
  if (tool === 'bash' || tool === 'pwsh' || tool === 'shell' || tool === 'terminal') {
    if (DESTRUCTIVE_SHELL.test(text)) return { risk: 'shell-write', label: `可能有副作用的 shell 命令` }
    return { risk: 'none', label: 'shell 命令' }
  }
  if (/plugin|install|uninstall|remove_bundle/i.test(tool)) return { risk: 'system', label: `插件/系统变更：${tool}` }
  if (EXTERNAL_TOOLS.test(tool) || EXTERNAL_TOOLS.test(text.slice(0, 200))) return { risk: 'external', label: `外部消息/发布：${tool}` }
  if (/memory|remember|记忆/i.test(tool)) return { risk: 'memory-write', label: `记忆写入：${tool}` }
  if (/subagent|teammate|spawn/i.test(tool)) return { risk: 'agent-spawn', label: `创建子 Agent：${tool}` }
  return { risk: 'none', label: tool }
}

function safeJson(value) {
  try { return JSON.stringify(value ?? null) } catch { return '' }
}

function extractPath(args) {
  if (!args || typeof args !== 'object') return null
  for (const key of ['file_path', 'path', 'filePath', 'target']) {
    if (typeof args[key] === 'string') return args[key]
  }
  return null
}

function sessionIdOf(session) {
  if (!session) return 'unknown'
  return typeof session.id === 'string' && session.id ? session.id : 'unknown'
}

function commitHash(cwd) {
  if (!cwd) return null
  try {
    const head = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim()
      return fs.readFileSync(path.join(cwd, '.git', ref), 'utf8').trim().slice(0, 12)
    }
    return head.slice(0, 12)
  } catch {
    return null
  }
}

export function createCheckpoint(core) {
  const { paths, log, config, ledger, now } = core
  const indexFile = path.join(paths.root, 'state', 'checkpoints.json')
  const index = (() => {
    const saved = readJson(indexFile, { items: [] })
    return Array.isArray(saved?.items) ? saved : { items: [] }
  })()
  const sessions = new Map()
  let timerDispose = null

  function sessionState(id) {
    if (!sessions.has(id)) {
      sessions.set(id, {
        sessionId: id,
        status: 'idle',
        turn: null,
        step: null,
        lastEventSeq: 0,
        lastEventType: null,
        lastError: null,
        retryCount: 0,
        startedAt: now().toISOString(),
        pending: new Map(),
        changedFiles: new Set(),
        assistantAt: null,
      })
    }
    return sessions.get(id)
  }

  function cwdFor(ctx, session) {
    try {
      return ctx?.get?.('workingDirectory')?.get?.(session) ?? null
    } catch {
      return null
    }
  }

  function build(ctx, state) {
    const pending = [...state.pending.values()]
    const sideEffects = pending.filter((entry) => entry.risk !== 'none')
    const taskId = sanitizeId(core.ledger?.state?.attributes?.[state.sessionId]?.taskId ?? state.sessionId)
    const record = {
      v: 1,
      taskId,
      sessionId: state.sessionId,
      parentTaskId: core.ledger?.state?.attributes?.[state.sessionId]?.parentTaskId ?? null,
      ownerAgent: core.ledger?.state?.attributes?.[state.sessionId]?.agentId ?? state.sessionId,
      status: state.status,
      dependsOn: [],
      startedAt: state.startedAt,
      updatedAt: now().toISOString(),
      turn: state.turn,
      step: state.step,
      lastEventSeq: state.lastEventSeq,
      lastEventType: state.lastEventType,
      pendingActions: pending.map(({ callId, tool, risk, label }) => ({ callId, tool, risk, label })),
      changedFiles: [...state.changedFiles].slice(-50),
      commitHash: commitHash(cwdFor(ctx, { id: state.sessionId })),
      lastError: state.lastError,
      retryCount: state.retryCount,
      risk: sideEffects.length > 0 ? 'review' : 'safe',
      sideEffects,
    }
    return record
  }

  function write(ctx, state) {
    const record = build(ctx, state)
    try {
      writeJson(checkpointFile(paths.root, record.taskId), record)
    } catch (error) {
      log?.error('checkpoint write failed', error)
      return null
    }
    const items = index.items.filter((item) => item.taskId !== record.taskId)
    items.push({
      taskId: record.taskId,
      sessionId: record.sessionId,
      status: record.status,
      risk: record.risk,
      updatedAt: record.updatedAt,
      pendingActions: record.pendingActions.length,
      changedFiles: record.changedFiles.length,
    })
    index.items = items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 100)
    try { writeJson(indexFile, index) } catch (error) { log?.error('checkpoint index write failed', error) }
    ledger?.note('checkpoints')
    return record
  }

  function onEvent(ctx, session, event) {
    const id = sessionIdOf(session)
    const state = sessionState(id)
    const data = event?.data ?? {}
    const settings = config.get('checkpoint')
    if (!config.get('enabled') || !settings.enabled) return
    state.lastEventSeq = Number(event?.seq ?? state.lastEventSeq)
    state.lastEventType = event?.type ?? state.lastEventType

    switch (event?.type) {
      case 'turn/start':
        state.status = 'running'
        state.turn = data.turn ?? null
        state.step = null
        state.startedAt = new Date(event.time ?? now().getTime()).toISOString()
        break
      case 'step/start':
        state.step = data.step ?? null
        break
      case 'tool/call': {
        const side = classifySideEffect(data.name, data.arguments)
        state.pending.set(String(data.callId ?? `call-${state.pending.size}`), {
          callId: String(data.callId ?? ''),
          tool: String(data.name ?? 'tool'),
          risk: side.risk,
          label: side.label,
        })
        const file = extractPath(data.arguments)
        if (file && (data.name === 'write' || data.name === 'edit')) state.changedFiles.add(file)
        break
      }
      case 'tool/result':
        state.pending.delete(String(data.callId ?? ''))
        if (data.error) state.lastError = `tool ${data.message?.toolName ?? ''}: ${data.error.name ?? 'error'}`
        break
      case 'assistant/message':
        state.assistantAt = new Date(event.time ?? now().getTime()).toISOString()
        break
      case 'turn/end':
        state.status = 'idle'
        // Write BEFORE clearing pending: a tool call that never produced a result
        // (interrupted turn) is exactly the side effect the next boot must see.
        if (settings.onTurnEnd) write(ctx, state)
        state.pending.clear()
        break
      default:
        break
    }
  }

  function attach(ctx) {
    const dispose = ctx.on('session/event', (session, event) => {
      try { onEvent(ctx, session, event) } catch (error) { log?.error('checkpoint event failed', error) }
    })
    const intervalMs = Math.max(5_000, config.get('checkpoint.intervalMs'))
    const tick = () => {
      for (const state of sessions.values()) {
        if (state.status === 'running') write(ctx, state)
      }
    }
    // Reading `ctx.timer` on a scope that did not inject the service throws
    // ("cannot get property \"timer\" without inject") instead of returning
    // undefined, so the access itself has to be guarded.
    let timerService = null
    try { timerService = ctx.timer ?? null } catch { timerService = null }
    if (timerService && typeof timerService.interval === 'function') {
      try { timerDispose = timerService.interval(tick, intervalMs) } catch (error) {
        log?.warn('checkpoint timer unavailable', error)
      }
    }
    if (!timerDispose) {
      const handle = setInterval(tick, intervalMs)
      handle.unref?.()
      timerDispose = () => clearInterval(handle)
    }
    return () => {
      try { dispose?.() } catch { /* ignore */ }
      try { timerDispose?.() } catch { /* ignore */ }
      for (const state of sessions.values()) if (state.status === 'running') write(ctx, state)
    }
  }

  /** Latest persisted checkpoint for a task/session id. */
  function load(taskId) {
    return readJson(checkpointFile(paths.root, sanitizeId(taskId)), null)
  }

  /**
   * Recovery plan for one interrupted task. Pure inspection: it never executes
   * a pending action. Anything with a side effect requires explicit approval.
   */
  function plan({ taskId, sessionId }) {
    const record = load(taskId ?? sessionId ?? '')
    if (!record) {
      return { found: false, canResume: false, requiresConfirmation: false, reasons: ['没有找到检查点'], steps: [] }
    }
    const reasons = []
    const sideEffects = record.pendingActions.filter((action) => action.risk !== 'none')
    if (record.lastError) reasons.push(`上次错误：${record.lastError}`)
    if (sideEffects.length) reasons.push(`存在 ${sideEffects.length} 个未确认副作用的操作`)
    if (record.status === 'running') reasons.push('检查点写入时任务仍在运行')
    const canResume = sideEffects.length === 0
    ledger?.note('recoveryChecks')
    return {
      found: true,
      checkpoint: record,
      canResume,
      requiresConfirmation: !canResume,
      reasons,
      steps: [
        '确认工作区当前状态（git status / git diff）',
        sideEffects.length ? '核对下列未完成操作是否已生效，禁止直接重放' : '从上次完成的步骤继续',
        '检查点文件：' + checkpointFile(paths.root, record.taskId),
      ],
      pendingActions: record.pendingActions,
    }
  }

  function list(limit = 20) {
    return index.items.slice(0, limit)
  }

  return {
    attach,
    onEvent,
    write: (ctx, sessionId) => write(ctx, sessionState(sessionId)),
    build: (ctx, sessionId) => build(ctx, sessionState(sessionId)),
    load,
    plan,
    list,
    snapshot: () => ({ items: list(20) }),
    sessions: () => [...sessions.values()].map((state) => ({ sessionId: state.sessionId, status: state.status, turn: state.turn, step: state.step, pending: state.pending.size })),
  }
}
