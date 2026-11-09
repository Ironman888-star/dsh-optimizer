/**
 * dsh-optimizer — Browser half.
 *
 * Hand-written as a `window.__ModuleLoader__` registration row, the only entry
 * point `@deepseek-ai/dsh-client-modules` serves from /plugins. `require`
 * resolves against the shell's platform module table, so React comes from the
 * page itself and this plugin ships no runtime of its own.
 *
 * Seating:
 *  - `settings.section` — the full page (cost ledger, budgets, anomalies,
 *    checkpoints, prompt audit, plugin switches).
 *  - `sidebar.footer.action` — a compact today/cache readout beside Settings.
 *
 * All data comes from the plugin's own same-origin Host routes; no cloud call,
 * no extra IPC face.
 */
window.__ModuleLoader__.load({
	id: 'dsh-optimizer',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useRef, useState } = React

		const BASE = '/dsh-optimizer'
		const POLL_MS = 10_000

		const COLOR = {
			text: 'var(--dsw-alias-label-primary)',
			muted: 'var(--dsw-alias-label-secondary)',
			weak: 'var(--dsw-alias-label-tertiary)',
			border: 'var(--dsw-alias-border-l1)',
			ok: 'var(--dsw-alias-state-success-primary)',
			warn: 'var(--dsw-alias-state-warn-primary)',
			err: 'var(--dsw-alias-state-error-primary)',
			bg: 'var(--dsw-alias-bg-layer-1)',
		}

		/* ── data ─────────────────────────────────────────────────────────── */

		async function getJson(path) {
			const response = await fetch(`${BASE}${path}`, {
				headers: { accept: 'application/json' },
				cache: 'no-store',
			})
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			return await response.json()
		}

		async function act(name, payload) {
			const headers = { 'content-type': 'application/json' }
			// A fresh one-shot token is required for either local owner-control action.
			// This prevents bare requests, but does NOT authenticate OS user identity.
			if (name === 'setPackingConfig' || name === 'setTaskInstructions') {
				const ticket = await getJson('/ui-control-token.json')
				if (!ticket?.token) throw new Error('无法获得设置页操作凭证')
				headers['x-dsh-optimizer-ui-token'] = ticket.token
			}
			const response = await fetch(`${BASE}/action.json`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ name, payload: payload ?? {} }),
			})
			const body = await response.json().catch(() => ({}))
			if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
			return body
		}

		function useOptimizerState() {
			const [state, setState] = useState(null)
			const [error, setError] = useState(null)
			const alive = useRef(true)

			const refresh = useCallback(async () => {
				try {
					const next = await getJson('/state.json')
					if (alive.current) {
						setState(next)
						setError(null)
					}
				} catch (cause) {
					if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
				}
			}, [])

			useEffect(() => {
				alive.current = true
				refresh()
				const timer = setInterval(refresh, POLL_MS)
				return () => {
					alive.current = false
					clearInterval(timer)
				}
			}, [refresh])

			return { state, error, refresh, setState }
		}

		/* ── formatting ───────────────────────────────────────────────────── */

		function int(value) {
			const n = Number(value)
			if (!Number.isFinite(n)) return '—'
			if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`
			if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
			if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
			return String(Math.round(n))
		}

		function usd(value) {
			const n = Number(value)
			if (!Number.isFinite(n)) return '—'
			if (n === 0) return '$0'
			if (n < 0.0001) return `$${n.toExponential(2)}`
			if (n < 0.01) return `$${n.toFixed(5)}`
			if (n < 1) return `$${n.toFixed(4)}`
			return `$${n.toFixed(2)}`
		}

		function pct(value) {
			const n = Number(value)
			if (!Number.isFinite(n)) return '—'
			return `${(n * 100).toFixed(1)}%`
		}

		function clock(iso) {
			if (!iso) return '—'
			const date = new Date(iso)
			if (Number.isNaN(date.getTime())) return '—'
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
		}

		/* ── primitives ───────────────────────────────────────────────────── */

		const CSS = {
			page: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 24px', color: COLOR.text, fontSize: 13 },
			head: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
			title: { fontSize: 15, fontWeight: 600, margin: 0 },
			chip: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${COLOR.border}`, color: COLOR.muted },
			grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
			card: { border: `1px solid ${COLOR.border}`, borderRadius: 10, padding: '10px 12px', background: COLOR.bg, minWidth: 0 },
			cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
			cardTitle: { fontSize: 11, color: COLOR.muted, letterSpacing: '0.02em', textTransform: 'uppercase' },
			big: { fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
			sub: { fontSize: 11, color: COLOR.muted, fontVariantNumeric: 'tabular-nums' },
			row: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontVariantNumeric: 'tabular-nums' },
			rowKey: { color: COLOR.muted },
			sectionTitle: { fontSize: 12, fontWeight: 600, margin: '10px 0 0' },
			bar: { height: 6, borderRadius: 999, background: 'var(--dsw-alias-fill-l2)', overflow: 'hidden' },
			barFill: { height: '100%', borderRadius: 999 },
			buttons: { display: 'flex', gap: 8, flexWrap: 'wrap' },
			button: {
				font: 'inherit',
				fontSize: 12,
				padding: '5px 11px',
				borderRadius: 7,
				border: `1px solid ${COLOR.border}`,
				background: 'transparent',
				color: COLOR.text,
				cursor: 'pointer',
			},
			buttonPrimary: {
				font: 'inherit',
				fontSize: 12,
				padding: '5px 11px',
				borderRadius: 7,
				border: `1px solid ${COLOR.border}`,
				background: 'var(--dsw-alias-fill-l2)',
				color: COLOR.text,
				cursor: 'pointer',
				fontWeight: 600,
			},
			table: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', fontSize: 11 },
			th: { textAlign: 'right', color: COLOR.muted, fontWeight: 500, padding: '4px 6px', borderBottom: `1px solid ${COLOR.border}` },
			thLeft: { textAlign: 'left', color: COLOR.muted, fontWeight: 500, padding: '4px 6px', borderBottom: `1px solid ${COLOR.border}` },
			td: { textAlign: 'right', padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
			tdLeft: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
			error: { color: COLOR.err, fontSize: 12 },
			muted: { color: COLOR.muted, fontSize: 11 },
			list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 },
			li: { display: 'flex', gap: 8, alignItems: 'baseline', fontVariantNumeric: 'tabular-nums' },
			severity: (severity) => ({
				fontSize: 10,
				padding: '1px 6px',
				borderRadius: 999,
				border: `1px solid ${COLOR.border}`,
				color: severity === 'error' ? COLOR.err : severity === 'warn' ? COLOR.warn : COLOR.muted,
			}),
			link: { color: 'var(--dsw-alias-label-link, ' + COLOR.text + ')', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 },
		}

		function Bar({ ratio, danger }) {
			const safe = Math.max(0, Math.min(1, Number(ratio) || 0))
			return h(
				'div',
				{ style: CSS.bar },
				h('div', {
					style: { ...CSS.barFill, width: `${(safe * 100).toFixed(1)}%`, background: danger ? COLOR.err : safe > 0.8 ? COLOR.warn : COLOR.ok },
				}),
			)
		}

		function Card({ title, right, children }) {
			return h('div', { style: CSS.card }, h('div', { style: CSS.cardHead }, h('span', { style: CSS.cardTitle }, title), right ?? null), children)
		}

		function KV({ k, v, strong }) {
			return h('div', { style: CSS.row }, h('span', { style: CSS.rowKey }, k), h('span', { style: strong ? { fontWeight: 600 } : null }, v))
		}

		function MiniBar({ label, used, cap, note }) {
			const ratio = cap > 0 ? used / cap : 0
			return h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 } },
				h(
					'div',
					{ style: CSS.row },
					h('span', { style: CSS.rowKey }, label),
					h('span', { style: CSS.sub }, `${usd(used)} / ${usd(cap)}${note ? ` · ${note}` : ''}`),
				),
				h(Bar, { ratio, danger: ratio > 1 }),
			)
		}

		/* ── pre-request historical context packing (independent of tool guard) ── */

		function ContextPackingPanel({ packing, refresh }) {
			const [turns, setTurns] = useState(packing.maxHistoryTurns ?? 3)
			const [working, setWorking] = useState(false)
			const [notice, setNotice] = useState('')
			useEffect(() => { setTurns(packing.maxHistoryTurns ?? 3) }, [packing.maxHistoryTurns])

			const enabled = packing.enabled === true
			const ready = packing.hookMounted === true
			const inputStyle = { font: 'inherit', fontSize: 12, padding: '6px 8px', borderRadius: 7,
				border: `1px solid ${COLOR.border}`, background: COLOR.bg, color: COLOR.text }

			async function save(nextEnabled = enabled) {
				const value = { enabled: nextEnabled, maxHistoryTurns: Number(turns) }
				if (!Number.isSafeInteger(value.maxHistoryTurns) || value.maxHistoryTurns < 1 || value.maxHistoryTurns > 20) {
					setNotice('最近对话轮数必须是 1–20 的整数')
					return
				}
				setWorking(true)
				setNotice('')
				try {
					const result = await act('setPackingConfig', value)
					setNotice(result?.ok === false ? `未执行：${(result.errors ?? []).join('；')}` : `已保存：${value.enabled ? '开启' : '关闭'}，保留最近 ${value.maxHistoryTurns} 轮`)
				} catch (error) {
					setNotice(`操作失败：${error?.message ?? error}`)
				} finally {
					setWorking(false)
					refresh()
				}
			}

			return h('div', { style: { ...CSS.card, padding: '15px 17px' } },
				h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
					h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
						h('span', { style: { fontSize: 14, fontWeight: 600 } }, '上下文打包控制（仅按最近轮数）'),
						h('span', { style: CSS.chip }, enabled ? '已开启' : '默认关闭'),
					),
					h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
						h('button', {
						type: 'button', role: 'switch', 'aria-checked': enabled,
						'aria-label': '启用最近对话轮数限制',
						disabled: working || (!enabled && !ready),
						onClick: () => save(!enabled),
						style: { position: 'relative', width: 45, height: 25, borderRadius: 999,
							border: `1px solid ${COLOR.border}`, background: enabled ? COLOR.ok : 'var(--dsw-alias-fill-l2, #c6c9ce)',
							cursor: working ? 'not-allowed' : 'pointer' },
					}, h('span', { style: { position: 'absolute', top: 2, left: enabled ? 21 : 2,
							width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px #0003' } })),
						h('span', { style: { ...CSS.sub, fontSize: 12 } }, enabled ? '开启' : '关闭'),
					),
				),
			h('p', { style: { ...CSS.muted, margin: '10px 0' } },
				'在组装模型请求前，只保留最近 N 轮已经完成的历史对话和当前轮；较早安全历史从模型可见范围移除，原始聊天记录不删除。'),
			h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' } },
				h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, color: COLOR.muted } },
					'保留最近几轮（1–20）',
					h('input', { type: 'number', min: 1, max: 20, step: 1, value: turns,
						style: { ...inputStyle, width: 125 }, onChange: event => setTurns(event.target.value) }),
				),
				h('button', { type: 'button', style: CSS.buttonPrimary,
					disabled: working, onClick: () => save(enabled) }, '保存轮数（直接生效）'),
			),
			!ready ? h('div', { style: { ...CSS.error, marginTop: 8 } },
				'DSH agents / agent/pre-step 未挂载：暂不能开启，请安装人员核对宿主兼容性。') : null,
			h('div', { style: { ...CSS.muted, marginTop: 9, lineHeight: 1.7 } },
				'一轮为一次用户提问及其对应回复（可能包含工具调用）；不再提供历史 Token 上限模式。',
				h('div', null, '系统/开发者指令、当前轮及未配对工具节点保留；较早轮次内的其他安全消息仍可裁剪。无法裁剪时会继续聊天。'),
				h('div', null, `预请求钩子：${ready ? '已挂载' : '未挂载'}；只会在宿主支持 Session surface 时裁剪。`),
			),
			h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 15, marginTop: 8 } },
				h('span', { style: CSS.sub }, `替换区段：${int(packing.replacements)} 次`),
				h('span', { style: CSS.sub }, `完整移除旧轮：${int(packing.removedHistoricalTurns)} 轮（累计）`),
				h('span', { style: CSS.sub }, `涉及裁剪旧轮：${int(packing.trimmedHistoricalTurns)} 轮（累计）`),
				h('span', { style: CSS.sub }, `已裁剪消息：${int(packing.removedMessageNodes)} 条（累计）`),
				h('span', { style: CSS.sub }, `无法裁剪已放行：${int(packing.skipped)} 次`),
				h('span', { style: CSS.sub }, `部分裁剪：${int(packing.partial)} 次`),
				h('span', { style: CSS.sub }, `清理失效旧系统提示词：${int(packing.obsoleteSystemNodesRemoved)} 条（累计）`),
				h('span', { style: CSS.sub }, `旧系统提示词减少：${int(packing.obsoleteSystemCharsRemoved)} 字符（累计）`),
			),
			packing.last ? h('div', { style: { ...CSS.muted, marginTop: 7 } },
				`最近处理：${packing.last.kind} · ${clock(packing.last.at)}${packing.last.reason ? ` · ${packing.last.reason}` : ''}`) : null,
			notice ? h('div', { role: 'status', style: { ...CSS.sub, marginTop: 8 } }, notice) : null,
			)
		}

		/* ── owner-editable task workflow instructions ─────────────────────── */

		function TaskInstructionsPanel({ configText, taskStatus, refresh }) {
			const [draft, setDraft] = useState(configText ?? '')
			const [working, setWorking] = useState(false)
			const [notice, setNotice] = useState('')
			useEffect(() => { setDraft(configText ?? '') }, [configText])
			const changed = draft !== (configText ?? '')

			async function save() {
				setWorking(true)
				setNotice('')
				try {
					const result = await act('setTaskInstructions', { text: draft })
					setNotice(result?.ok === false ? `保存失败：${(result.errors ?? []).join('；')}` : '任务指令已保存，后续模型请求生效')
				} catch (error) {
					setNotice(`保存失败：${error?.message ?? error}`)
				} finally {
					setWorking(false)
					refresh()
				}
			}

			return h('div', { style: { ...CSS.card, padding: '15px 17px' } },
				h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 7 } }, '任务指令改写'),
				h('div', { style: { ...CSS.muted, marginBottom: 9 } },
					'预置常用任务指令；可以直接修改、追加新指令，保存后用于后续任务。清空并保存即可停止注入。'),
				h('textarea', { value: draft, rows: 8, maxLength: 12000,
					'aria-label': '编辑常用任务指令',
					onChange: event => { setDraft(event.target.value); setNotice('') },
					style: { boxSizing: 'border-box', width: '100%', resize: 'vertical', borderRadius: 8,
						border: `1px solid ${COLOR.border}`, padding: 10, font: 'inherit', lineHeight: 1.6,
						background: COLOR.bg, color: COLOR.text, minHeight: 135 },
				}),
				h('div', { style: { ...CSS.buttons, alignItems: 'center', marginTop: 9 } },
					h('button', { type: 'button', disabled: working || !changed, style: CSS.buttonPrimary, onClick: save },
						working ? '正在保存…' : '保存任务指令'),
					h('button', { type: 'button', disabled: working, style: CSS.button,
						onClick: () => { setDraft(taskStatus.defaultText ?? ''); setNotice('') } }, '恢复预置内容'),
					h('span', { style: CSS.sub }, `${draft.length}/12000 字符 · ${changed ? '尚未保存' : '已保存'}`),
				),
				h('div', { style: { ...CSS.muted, marginTop: 8 } },
					`系统提示词注册：${taskStatus.sectionMounted ? '已挂载' : '未挂载（检查 DSH systemPrompt 服务）'}。这是任务行为指导，不是访问权限限制；完全覆盖式提示词可能不包含本区指令。`),
				notice ? h('div', { role: 'status', style: { ...CSS.sub, marginTop: 7 } }, notice) : null,
			)
		}

		/* ── settings page ────────────────────────────────────────────────── */

		function SectionPage() {
			const { state, error, refresh } = useOptimizerState()
			const [busy, setBusy] = useState(null)
			const [notice, setNotice] = useState(null)

			const run = useCallback(
				async (name, payload) => {
					setBusy(name)
					setNotice(null)
					try {
						const result = await act(name, payload)
						if (result && result.ok === false) setNotice(`操作未生效：${(result.errors ?? []).join('；') || '未知原因'}`)
						else if (name === 'report' && result?.files) setNotice(`报告已生成：${result.files.join(' , ')}`)
						else setNotice('已完成')
					} catch (cause) {
						setNotice(`操作失败：${cause instanceof Error ? cause.message : String(cause)}`)
					} finally {
						setBusy(null)
						refresh()
					}
				},
				[refresh],
			)

			if (!state) {
				return h(
					'div',
					{ style: CSS.page },
					h('h3', { style: CSS.title }, '智能优化管家'),
					error ? h('div', { style: CSS.error }, `无法连接 Host 路由：${error}`) : h('div', { style: CSS.muted }, '正在读取优化状态…'),
				)
			}

			const plugin = state.plugin ?? {}
			const ledger = state.ledger ?? {}
			const today = ledger.today ?? {}
			const totals = ledger.project ?? {}
			const metrics = ledger.metrics?.today ?? {}
			const budget = state.budget ?? {}
			const scopes = budget.scopes ?? {}
			const limits = state.config?.budgets ?? {}
			const days = Array.isArray(ledger.series) ? ledger.series.filter((day) => Number(day.requests) > 0).slice(-7) : []
			const anomalies = Array.isArray(state.anomalies?.recent) ? state.anomalies.recent.slice(0, 6) : []
			const anomalyTotal =
				Object.values(state.anomalies?.counts ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0) || anomalies.length
			const checkpointItems = Array.isArray(state.checkpoints?.items) ? state.checkpoints.items : []
			const checkpoints = checkpointItems.slice(0, 6)
			const modules = Array.isArray(state.modules) ? state.modules : []
			const promptLatest = state.prompt?.latest ?? null
			const toolResult = state.toolResult ?? {}

			const setMode = (mode) => run('setMode', { mode })
			const toggleEnabled = () => run('setEnabled', { enabled: !plugin.enabled })

			return h(
				'div',
				{ style: CSS.page },
				h(
					'div',
					{ style: CSS.head },
					h('h3', { style: CSS.title }, '智能优化管家'),
					h('span', { style: CSS.chip }, `v${plugin.version ?? '?'}`),
					h('span', { style: CSS.chip }, plugin.mode === 'enforce' ? '安全优化模式' : '只审计模式'),
					plugin.paused ? h('span', { style: { ...CSS.chip, color: COLOR.warn } }, '已暂停') : null,
					plugin.enabled === false ? h('span', { style: { ...CSS.chip, color: COLOR.err } }, '已禁用') : null,
					h('span', { style: { flex: 1 } }),
					h('span', { style: CSS.muted }, `更新于 ${clock(new Date().toISOString())}`),
				),
				error ? h('div', { style: CSS.error }, `读取失败：${error}`) : null,
				h(ContextPackingPanel, { packing: state.contextPacking ?? {}, refresh }),
				h(TaskInstructionsPanel, { configText: state.config?.taskInstructions?.text ?? '', taskStatus: state.taskInstructions ?? {}, refresh }),
				h(
					'div',
					{ style: CSS.grid },
					h(
						'div',
						{ style: CSS.card },
						h('div', { style: CSS.cardTitle }, '今日费用（估算）'),
						h('div', { style: CSS.big }, usd(today.costUSD)),
						h('div', { style: CSS.sub }, `${int(today.requests)} 次请求 · 输出 ${int(today.outputTokens)} tok`),
					),
					h(
						'div',
						{ style: CSS.card },
						h('div', { style: CSS.cardTitle }, '今日输入'),
						h('div', { style: CSS.big }, int(today.inputTokens)),
						h('div', { style: CSS.sub }, `缓存命中 ${pct(today.cacheHitRate)} · 未命中 ${int(today.uncachedInputTokens)}`),
					),
					h(
						'div',
						{ style: CSS.card },
						h('div', { style: CSS.cardTitle }, '累计费用（估算）'),
						h('div', { style: CSS.big }, usd(totals.costUSD)),
						h('div', { style: CSS.sub }, `${int(totals.requests)} 次请求 · ${days.length} 天记录`),
					),
					h(
						'div',
						{ style: CSS.card },
						h('div', { style: CSS.cardTitle }, '异常 / 检查点'),
						h('div', { style: CSS.big }, `${int(anomalyTotal)} / ${int(checkpointItems.length)}`),
						h('div', { style: CSS.sub }, `最近 ${anomalies.length} 条异常可查`),
					),
				),
				h(
					Card,
					{ title: '预算（估算，非账单）' },
					h(MiniBar, { label: '今日', used: scopes.day?.usedUSD ?? 0, cap: scopes.day?.limitUSD ?? limits.dailyUSD ?? 0 }),
					h(MiniBar, { label: '项目累计', used: scopes.project?.usedUSD ?? 0, cap: scopes.project?.limitUSD ?? limits.projectUSD ?? 0 }),
					h(MiniBar, { label: '单任务上限（最高任务）', used: scopes.tasks?.[0]?.usedUSD ?? 0, cap: scopes.tasks?.[0]?.limitUSD ?? limits.perTaskUSD ?? 0 }),
					h(MiniBar, { label: '单 Agent 上限（最高 Agent）', used: scopes.agents?.[0]?.usedUSD ?? 0, cap: scopes.agents?.[0]?.limitUSD ?? limits.perAgentUSD ?? 0 }),
				),
				h(
					Card,
					{ title: '优化动作（本机执行，无额外云端调用）' },
					h(
						'div',
						{ style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 } },
						h(KV, { k: '工具结果裁剪', v: `${int(metrics.toolResultsPruned)} 次 / 省 ${int(metrics.toolCharsPruned)} 字符` }),
						h(KV, { k: '工具结果去重', v: `${int(metrics.toolResultsDeduped)} 次` }),
						h(KV, { k: '裁剪工具字符估算', v: `${int(toolResult.savedTokensEst)} tok` }),
						h(KV, { k: '提示词审计', v: `${int(metrics.promptSectionsTrimmed)} 段 / 省 ${int(metrics.promptCharsRemoved)} 字符` }),
						h(KV, { k: '上下文预警', v: `${int(metrics.contextPressureEvents)} 次` }),
						h(KV, { k: '检查点', v: `${int(metrics.checkpoints)} 次` }),
						h(KV, { k: '异常', v: `${int(metrics.anomalies)} 次` }),
						h(KV, { k: '子 Agent 建议', v: `${int(metrics.subagentsSpawned)} 次` }),
					),
				),
				h(
					Card,
					{ title: '提示词体量（最近一次组装）' },
					promptLatest
						? h(
								'div',
								{ style: { display: 'flex', flexDirection: 'column', gap: 6 } },
								h(KV, { k: '总字符 / 估算 tokens', v: `${int(promptLatest.totalChars)} / ${int(promptLatest.totalTokensEst)}`, strong: true }),
								h(KV, { k: 'section 数 / 工具数', v: `${int(promptLatest.sectionCount)} / ${int(promptLatest.toolCount)}` }),
								h(KV, { k: '重复段落', v: `${int((promptLatest.duplicates ?? []).length)} 组` }),
								Array.isArray(promptLatest.sections)
									? h(
											'table',
											{ style: CSS.table },
											h('thead', null, h('tr', null, h('th', { style: CSS.thLeft }, '区块'), h('th', { style: CSS.th }, '字符'), h('th', { style: CSS.th }, '≈tokens'))),
											h(
												'tbody',
												null,
												promptLatest.sections.slice(0, 8).map((section, index) =>
													h('tr', { key: `${section.name}-${index}` }, h('td', { style: CSS.tdLeft }, section.name), h('td', { style: CSS.td }, int(section.chars)), h('td', { style: CSS.td }, int(section.tokens))),
												),
											),
										)
									: null,
							)
						: h('div', { style: CSS.muted }, '尚无提示词样本（等待下一次模型请求）。'),
				),
				h(
					Card,
					{ title: '近 7 天' },
					days.length
						? h(
								'table',
								{ style: CSS.table },
								h(
									'thead',
									null,
									h(
										'tr',
										null,
										h('th', { style: CSS.thLeft }, '日期'),
										h('th', { style: CSS.th }, '请求'),
										h('th', { style: CSS.th }, '输入'),
										h('th', { style: CSS.th }, '命中率'),
										h('th', { style: CSS.th }, '输出'),
										h('th', { style: CSS.th }, '费用'),
									),
								),
								h(
									'tbody',
									null,
									days.map((day) =>
										h(
											'tr',
											{ key: day.day },
											h('td', { style: CSS.tdLeft }, day.day),
											h('td', { style: CSS.td }, int(day.requests)),
											h('td', { style: CSS.td }, int(day.inputTokens)),
											h('td', { style: CSS.td }, pct(day.cacheHitRate)),
											h('td', { style: CSS.td }, int(day.outputTokens)),
											h('td', { style: CSS.td }, usd(day.costUSD)),
										),
									),
								),
							)
						: h('div', { style: CSS.muted }, '今日还没有用量记录。'),
				),
				h(
					Card,
					{ title: '最近异常' },
					anomalies.length
						? h(
								'ul',
								{ style: CSS.list },
								anomalies.map((item, index) =>
									h(
										'li',
										{ key: `${item.kind}-${index}`, style: CSS.li },
										h('span', { style: CSS.severity(item.severity) }, item.severity ?? 'info'),
										h('span', { style: { fontWeight: 500 } }, item.kind),
										h('span', { style: CSS.muted }, item.message ?? ''),
										h('span', { style: { flex: 1 } }),
										h('span', { style: CSS.muted }, clock(item.ts)),
									),
								),
							)
						: h('div', { style: CSS.muted }, '没有异常记录。'),
				),
				h(
					Card,
					{ title: '检查点 / 恢复' },
					checkpoints.length
						? h(
								'ul',
								{ style: CSS.list },
								checkpoints.map((item, index) =>
									h(
										'li',
										{ key: `${item.taskId}-${index}`, style: CSS.li },
										h('span', { style: { fontWeight: 500 } }, item.taskId),
										h('span', { style: CSS.muted }, item.status ?? ''),
										h('span', { style: CSS.muted }, `turn ${int(item.turn)} · ${item.pendingActions ? `${item.pendingActions} 待确认` : '无副作用挂起'}`),
										h('span', { style: { flex: 1 } }),
										h(
											'span',
											{
												style: CSS.link,
												onClick: () => run('checkpointPlan', { taskId: item.taskId }),
												title: '只检查，不执行任何操作',
											},
											'检查可恢复性',
										),
									),
								),
							)
						: h('div', { style: CSS.muted }, '本会话还没有写入检查点。'),
					notice ? h('div', { style: CSS.muted }, notice) : null,
				),
				h(
					Card,
					{ title: '控制' },
					h(
						'div',
						{ style: CSS.buttons },
						h(
							'button',
							{ type: 'button', style: CSS.buttonPrimary, disabled: busy !== null, onClick: () => run(plugin.paused ? 'resume' : 'pause') },
							plugin.paused ? '恢复监控' : '暂停监控',
						),
						h(
							'button',
							{ type: 'button', style: plugin.mode === 'audit' ? CSS.buttonPrimary : CSS.button, disabled: busy !== null, onClick: () => setMode('audit') },
							'只审计',
						),
						h(
							'button',
							{
								type: 'button',
								style: plugin.mode === 'enforce' ? CSS.buttonPrimary : CSS.button,
								disabled: busy !== null,
								onClick: () => setMode('enforce'),
								title: '仅在权限范围内做安全优化：工具结果精简、提示词去重',
							},
							'安全优化',
						),
						h('button', { type: 'button', style: CSS.button, disabled: busy !== null, onClick: () => run('report') }, '生成费用报告'),
						h('button', { type: 'button', style: CSS.button, disabled: busy !== null, onClick: () => run('flush') }, '立即落盘'),
						h('button', { type: 'button', style: CSS.button, disabled: busy !== null, onClick: () => run('prune') }, '清理过期数据'),
						h('button', { type: 'button', style: CSS.button, disabled: busy !== null, onClick: toggleEnabled }, plugin.enabled === false ? '启用插件' : '禁用插件'),
						h(
							'span',
							{ style: CSS.link, onClick: () => window.open(`${BASE}/dashboard`, '_blank', 'noopener') },
							'打开本地仪表盘',
						),
					),
					h(
						'div',
						{ style: { ...CSS.muted, marginTop: 8 } },
						`状态目录：${plugin.stateRoot ?? '—'} · 计价版本：${plugin.pricingVersion ?? '—'} · 费用为本地估算，以供应商账单为准`,
					),
				),
				h(
					Card,
					{ title: '模块状态' },
					h(
						'ul',
						{ style: CSS.list },
						modules.map((item) =>
							h(
								'li',
								{ key: item.id, style: CSS.li },
								h('span', { style: CSS.severity(item.state === 'mounted' ? 'info' : item.state === 'failed' ? 'error' : 'warn') }, item.state),
								h('span', null, item.id),
								h('span', { style: CSS.muted }, item.detail ?? ''),
							),
						),
					),
				),
			)
		}

		/* ── sidebar readout ─────────────────────────────────────────────── */

		function FooterReadout() {
			const { state, error, refresh } = useOptimizerState()
			const [open, setOpen] = useState(false)

			const today = state?.ledger?.today ?? {}
			const cost = usd(today.costUSD)
			const hit = pct(today.cacheHitRate)
			const anomalyTotal =
				Object.values(state?.anomalies?.counts ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0) ||
				(state?.anomalies?.recent ?? []).length
			const checkpointTotal = (state?.checkpoints?.items ?? []).length
			const label = error ? '优化管家离线' : `今日 ${cost} · 命中 ${hit}`

			const onActivate = () => {
				setOpen((value) => !value)
				if (!open) refresh()
			}

			return h(
				'button',
				{
					type: 'button',
					style: {
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'stretch',
						gap: 2,
						width: '100%',
						textAlign: 'left',
						font: 'inherit',
						fontSize: 11,
						padding: '4px 8px',
						borderRadius: 7,
						border: '1px solid transparent',
						background: 'transparent',
						color: COLOR.text,
						cursor: 'pointer',
					},
					title: label,
					'aria-label': label,
					onClick: onActivate,
				},
				h('span', { style: { display: 'flex', justifyContent: 'space-between', gap: 6 } }, h('span', { style: { color: COLOR.muted } }, '今日'), h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, cost)),
				h('span', { style: { display: 'flex', justifyContent: 'space-between', gap: 6 } }, h('span', { style: { color: COLOR.muted } }, '缓存命中'), h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, hit)),
				open
					? h(
							'span',
							{ style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, color: COLOR.muted } },
							h('span', null, `请求 ${int(today.requests)} · 输出 ${int(today.outputTokens)} tok`),
							h('span', null, `未命中输入 ${int(today.uncachedInputTokens)} tok`),
							h('span', null, `异常 ${int(anomalyTotal)} · 检查点 ${int(checkpointTotal)}`),
							h('span', null, '完整面板在 设置 → 智能优化管家'),
						)
					: null,
			)
		}

		/* ── registration ────────────────────────────────────────────────── */

		exports.inject = ['slots']
		exports.apply = function apply(ctx) {
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: 'dsh-optimizer',
						order: 25,
						label: () => '智能优化管家',
					},
					SectionPage,
				),
			)
			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register(
					{
						name: 'sidebar.footer.action',
						id: 'dsh-optimizer',
						order: 40,
						label: () => '智能优化管家',
					},
					FooterReadout,
				),
			)
		}

		return module.exports
	},
})
