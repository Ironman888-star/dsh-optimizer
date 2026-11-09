/** Editable local task-workflow guidance. This is advisory prompt text, not a security gate. */
export const MAX_TASK_INSTRUCTIONS_CHARS = 12_000
export const DEFAULT_TASK_INSTRUCTIONS_TEXT = [
  '1. 只搜索与任务直接相关的目录和文件。',
  '2. 不要重复执行无结果的搜索。',
  '3. 找不到证据时说明不确定性，不要无限扩大范围。',
  '4. 每轮结束检查是否已经能够回答问题。',
  '5. 达到工具调用上限时，立即汇报已确认的结果和未完成事项。',
].join('\n')

export const TASK_SECTION_NAME = 'dsh-optimizer:task-instructions'

export function createTaskInstructions(core) {
  const { config, log } = core
  let sectionMounted = false
  let disposed = false

  const text = () => {
    const content = String(config.get('taskInstructions.text') ?? '').trim()
    return content ? `任务执行指导（遵守更高优先级指令和主人当前明确要求）：\n${content}` : ''
  }

  function attach(ctx) {
    const service = ctx?.systemPrompt ?? ctx?.get?.('systemPrompt')
    if (typeof service?.section !== 'function') {
      log?.warn('task instructions unavailable: systemPrompt.section not provided')
      return () => {}
    }
    const dispose = service.section({
      name: TASK_SECTION_NAME,
      order: 9800,
      interpolate: false,
      text,
    })
    sectionMounted = true
    disposed = false
    return () => {
      if (disposed) return
      disposed = true
      sectionMounted = false
      try { dispose?.() } catch (error) { log?.warn('task instruction section dispose failed', error) }
    }
  }

  function change(payload) {
    const value = payload?.text
    if (typeof value !== 'string' || value.length > MAX_TASK_INSTRUCTIONS_CHARS) {
      return { ok: false, errors: [`任务指令必须是文本且不超过 ${MAX_TASK_INSTRUCTIONS_CHARS} 字符`] }
    }
    const result = config.set('taskInstructions.text', value.replace(/\r\n/g, '\n'))
    return { ok: result.ok, errors: result.errors, chars: value.length }
  }

  return {
    attach,
    change,
    currentText: text,
    snapshot: () => ({ sectionMounted, chars: String(config.get('taskInstructions.text') ?? '').length,
      defaultText: DEFAULT_TASK_INSTRUCTIONS_TEXT }),
  }
}
