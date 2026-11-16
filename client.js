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
				h(Card, { title: '聊天消息与轮次删除（原作者 dsh-delete-turn v0.2.7）', right: h('span', { style: CSS.chip }, (state.modules ?? []).some(x => x.id === 'messageDelete' && x.state === 'mounted') ? '已挂载' : '未挂载') },
					h('div', { style: CSS.muted }, '支持单条消息、工具步骤、整条回复、整轮对话和多选删除；直接使用聊天界面中的删除图标。删除只影响后续模型上下文与聊天视图，原始追加日志仍保留。'),
					h('div', { style: { ...CSS.muted, marginTop: 6 } }, '删除前默认弹出确认；压缩遮蔽的旧内容、仍在执行的工具链与系统提示词会受到宿主兼容性限制。请勿同时启用独立 dsh-delete-turn 插件。'),
					vendorDeleteConfigCard ? h(vendorDeleteConfigCard, { t: key => ({'config.ask':'删除前询问', 'config.hint.ask':'每次删除前弹出确认框。', 'config.hint.auto':'删除直接执行，不再询问。'})[key] ?? key }) : null),

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

		/* ── upstream dsh-delete-turn v0.2.7 integrated below ── */

    function makeVendoredDeleteClient(require) {

    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { jsx, jsxs, Fragment } = jsxRuntime

    const NS = 'dsh-delete-turn'
    const ROUTE_PREFIX = '/dsh-delete-turn'
    // Minimum gap between automatic snapshot refreshes while a transcript grows.
    const REFRESH_INTERVAL_MS = 3000

    // --- preferences ----------------------------------------------------------
    //
    // One client-side preference: whether a deletion opens the confirmation
    // dialog first. It lives in localStorage - the same store the official
    // client plugins keep their view options in - so it survives reloads with no
    // host round-trip, and a subscription keeps the settings page and the delete
    // paths on one value.

    const PREFS_KEY = 'dsh-delete-turn:prefs'
    const DEFAULT_ASK = true

    function readStoredAsk() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_ASK
        const raw = window.localStorage.getItem(PREFS_KEY)
        if (raw === null) return DEFAULT_ASK
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed.ask === 'boolean' ? parsed.ask : DEFAULT_ASK
      } catch {
        // A missing or malformed entry falls back to the shipped default rather
        // than breaking the host: the dialog path is the safe behaviour.
        return DEFAULT_ASK
      }
    }

    let askBeforeDelete = readStoredAsk()
    const prefListeners = new Set()

    function getPrefs() {
      return { ask: askBeforeDelete }
    }

    function setAskBeforeDelete(value) {
      const ask = value === true
      if (askBeforeDelete === ask) return
      askBeforeDelete = ask
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ask }))
        }
      } catch {
        // Storage that refuses writes (private mode) must not break the toggle.
      }
      for (const listener of prefListeners) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-delete-turn] preference subscriber threw:', error)
        }
      }
    }

    function subscribePrefs(listener) {
      prefListeners.add(listener)
      return () => {
        prefListeners.delete(listener)
      }
    }

    // --- copy -----------------------------------------------------------------

    const zh = {
      'action.tooltip.message': '删除这条消息',
      'action.tooltip.turn': '删除这一轮',
      'action.tooltip.step': '删除这一步',
      'action.tooltip.reply': '删除这条回复',
      'dialog.title.message': '删除这条消息？',
      'dialog.title.turn': '删除这一轮？',
      'dialog.title.step': '删除这一步？',
      'dialog.title.reply': '删除这条回复？',
      'dialog.desc.message': '这条消息将从模型上下文中移除，并从当前转录中隐藏。原始会话日志保持不变。',
      'dialog.desc.turn': '这一轮（含你的提问、注入上下文、全部回复与工具结果）将从模型上下文中移除；它之后的轮次原样保留，在对话视图里直接接上来。',
      'dialog.desc.step': '这一步的回复与它请求的工具结果将一并从模型上下文中移除，同一回合的其它步骤保留。',
      'dialog.desc.reply': '这条回复连同它的思考、工具调用与注入上下文将从模型上下文中移除，你的提问会保留。',
      'dialog.note': '删除只影响模型后续看到的内容，不会改写历史日志。',
      'dialog.busyWarning': '当前回复正在生成；删除会先停止它，再继续。',
      'dialog.extraWarning': '这段范围里还夹着别的内容；确认后会一并移除。',
      'dialog.confirmExtra': '一并删除',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.pending': '删除中…',
      'dialog.retry': '重试',
      'dialog.title.batch': '删除选中的内容？',
      'dialog.desc.batch': '选中的消息、步骤与回复将从模型上下文中一并移除；没有被选中的内容保持原样。',
      'action.tooltip.select': '多选删除',
      'action.tooltip.selected': '已选中，再点一次取消',
      'select.count': '已选',
      'select.unit': '项',
      'select.delete': '删除选中',
      'select.cancel': '取消',
      'config.ask': '删除时询问',
      'config.hint.ask': '每次删除前都会弹出确认框。',
      'config.hint.auto': '删除会直接执行，不再询问。',
      'config.summary.ask': '删除前询问',
      'config.summary.auto': '直接删除',
      'error.invalid': '请求无效，请刷新后重试。',
      'error.session-not-active': '这个会话当前未激活，请先打开该会话再删除。',
      'error.session-not-found': '找不到该会话的日志。',
      'error.busy': '该会话正在进行中，且当前无法自动停止（可能正在压缩），请稍后重试。',
      'error.stop-timeout': '已请求停止当前生成，但该回合没有及时停下；请稍后再试。',
      'error.already-deleted': '这条内容已经从上下文中删除了。',
      'error.not-deletable': '这个位置不支持删除。',
      'error.range-not-clean': '目标区间包含其它内容，已取消删除。',
      'error.nothing-to-delete': '这个回合没有可删除的回复内容。',
      'error.stale': '会话刚刚发生了变化，请重试。',
      'error.forbidden': '请求来源不被允许。',
      'error.generic': '删除失败，请重试。',
    }

    const en = {
      'action.tooltip.message': 'Delete this message',
      'action.tooltip.turn': 'Delete this turn',
      'action.tooltip.step': 'Delete this step',
      'action.tooltip.reply': 'Delete this reply',
      'dialog.title.message': 'Delete this message?',
      'dialog.title.turn': 'Delete this turn?',
      'dialog.title.step': 'Delete this step?',
      'dialog.title.reply': 'Delete this reply?',
      'dialog.desc.message': 'This message leaves the model context and is hidden from the current transcript. The original session log stays untouched.',
      'dialog.desc.turn': 'This turn (your prompt, injected context, every reply step and tool result) leaves the model context. Later turns stay exactly where they are and simply move up in the transcript.',
      'dialog.desc.step': 'This step and the tool results it requested leave the model context together; other steps in the same turn stay.',
      'dialog.desc.reply': 'This reply leaves the model context together with its reasoning, tool calls and injected context; your prompt stays.',
      'dialog.note': 'Deletion only changes what the model sees next; the append-only log is never rewritten.',
      'dialog.busyWarning': 'A reply is still generating; deleting will stop it first.',
      'dialog.extraWarning': 'This range also covers other content; confirming removes it as well.',
      'dialog.confirmExtra': 'Delete all of it',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete',
      'dialog.pending': 'Deleting...',
      'dialog.retry': 'Retry',
      'dialog.title.batch': 'Delete the selected items?',
      'dialog.desc.batch': 'The selected messages, steps and replies leave the model context together; everything not selected stays exactly as it is.',
      'action.tooltip.select': 'Select for multi-delete',
      'action.tooltip.selected': 'Selected - click again to unselect',
      'select.count': 'Selected',
      'select.unit': '',
      'select.delete': 'Delete selected',
      'select.cancel': 'Cancel',
      'config.ask': 'Ask before deleting',
      'config.hint.ask': 'Show a confirmation dialog before every deletion.',
      'config.hint.auto': 'Delete right away without asking.',
      'config.summary.ask': 'Ask before deleting',
      'config.summary.auto': 'Delete without asking',
      'error.invalid': 'Invalid request; refresh and try again.',
      'error.session-not-active': 'This session is not open in DSH; open it first.',
      'error.session-not-found': 'No session log was found for this id.',
      'error.busy': 'This session is working and cannot be stopped right now (a compaction may be running); try again in a moment.',
      'error.stop-timeout': 'The running turn did not stop in time; try again in a moment.',
      'error.already-deleted': 'This content is already removed from the context.',
      'error.not-deletable': 'This position cannot be deleted.',
      'error.range-not-clean': 'The target window contains unrelated content; the delete was cancelled.',
      'error.nothing-to-delete': 'This turn has no reply content to delete.',
      'error.stale': 'The session just changed; try again.',
      'error.forbidden': 'The request origin is not allowed.',
      'error.generic': 'Delete failed; try again.',
    }

    // --- style ----------------------------------------------------------------

    const CSS = [
      '.dshdt-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:pointer;transition:background-color .12s,color .12s}',
      '.dshdt-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-state-error-primary,#d54941)}',
      '.dshdt-action:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4d6bfe);outline-offset:2px}',
      '.dshdt-action:disabled{cursor:default;opacity:.4}',
      '.dshdt-action svg{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px))}',
      '.dshdt-action-host{display:inline-flex;align-items:center;justify-content:center}',
      '.dshdt-row{position:relative}',
      '.dshdt-floating{position:absolute;top:2px;right:6px;z-index:2;opacity:0;transition:opacity .12s}',
      '.dshdt-row:hover .dshdt-floating,.dshdt-floating:focus-within{opacity:1}',
      // While rows are being picked, every toggle has to be reachable without a hover pass over each row.
      // In the mode the hover host would only sit as an empty box over the
      // badge, so it steps out entirely instead of fading in.
      '.dshdt-select-on .dshdt-floating{display:none}',
      '[data-variant="think"]{position:relative}',
      '.dshdt-think-action{position:absolute;top:0;right:4px;opacity:0;transition:opacity .12s}',
      '[data-variant="think"]:hover .dshdt-think-action,.dshdt-think-action:focus-within{opacity:1}',
      '.dshdt-collapsing{overflow:hidden;transition:height .2s ease,opacity .14s ease,margin .2s ease,padding .2s ease}',
      '[data-dshdt-hidden="1"]{display:none!important}',
      // The second row action: delete the whole turn (prompt included). It is
      // its own class so the trash action's selector, its counts and the
      // interop contract stay exactly as they were; the row attribute turns it
      // on only where the host can plan the operation.
      '.dshdt-turn{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;display:none;align-items:center;justify-content:center;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:pointer;transition:background-color .12s,color .12s}',
      '[data-dshdt-turn="1"] .dshdt-turn{display:inline-flex}',
      '.dshdt-turn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-button-primary-fill,#4d6bfe)}',
      '.dshdt-turn:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4d6bfe);outline-offset:2px}',
      '.dshdt-turn:disabled{cursor:default;opacity:.4}',
      '.dshdt-turn svg{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px))}',
      '[data-dshdt-no-target="1"] .dshdt-action{display:none!important}',
      // In multi-select the toggle is a badge pinned to the row itself: the
      // action strip of a message row only exists while the pointer is on it,
      // so a toggle parked inside that strip is invisible exactly when the
      // mode needs it.
      '.dshdt-check{width:22px;height:22px;padding:0;display:none;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.14);transition:background-color .12s,color .12s}',
      '.dshdt-select-on{position:relative;opacity:1!important}',
      '.dshdt-select-on>.dshdt-check{display:inline-flex;position:absolute;top:6px;right:6px;z-index:5}',
      '.dshdt-check:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-button-primary-fill,#4d6bfe)}',
      '.dshdt-check:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4d6bfe);outline-offset:2px}',
      '.dshdt-check svg{width:13px;height:13px}',
      '.dshdt-checked .dshdt-check{color:var(--dsw-alias-button-primary-fill,#4d6bfe)}',
      '.dshdt-checked{outline:2px solid var(--dsw-alias-button-primary-fill,#4d6bfe);outline-offset:-2px;border-radius:14px}',
      '.dshdt-action-host[data-dshdt-badge-only="1"] .dshdt-action,.dshdt-action-host[data-dshdt-badge-only="1"] .dshdt-turn{display:none!important}',
      '.dshdt-action-host[data-dshdt-badge-only="1"]{pointer-events:none}',
      '.dshdt-action-host[data-dshdt-badge-only="1"]>.dshdt-check{pointer-events:auto}',
      '.dshdt-select-on .dshdt-action,.dshdt-select-on .dshdt-turn{display:none!important}',
      // The header entry sits among the Session utilities: the same 32px pill
      // the official utilities use, icon-only to stay compact.
      '.dshdt-header-select{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:32px;height:32px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:20px;cursor:pointer;transition:background-color .12s,color .12s,border-color .12s}',
      '.dshdt-header-select:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dshdt-header-select:disabled{color:var(--dsw-alias-label-dimmed,#9aa0aa);cursor:wait}',
      '.dshdt-header-select svg{flex:none}',
      '.dshdt-header-select-on{color:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);background:var(--dsw-alias-button-primary-ghost-fill,rgba(77,107,254,.08))}',
      '.dshdt-selectbar{position:fixed;right:24px;bottom:150px;z-index:60;display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.2));box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:12px}',
      '.dshdt-selectbar-count{color:var(--dsw-alias-label-secondary,#5c6270);font-size:12px;white-space:nowrap}',
      '.dshdt-dialog-text{margin:0;color:var(--dsw-alias-label-primary,inherit);font-size:14px;line-height:22px}',
      '.dshdt-dialog-note{margin:10px 0 0;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:13px;line-height:20px}',
      '.dshdt-dialog-warn{margin:10px 0 0;color:var(--dsw-alias-state-warn-primary,#a15c00);font-size:13px;line-height:20px}',
      '.dshdt-dialog-error{margin:10px 0 0;color:var(--dsw-alias-state-error-primary,#d54941);font-size:13px;line-height:20px}',
      '.dshdt-config{display:flex;flex-direction:column;gap:8px}',
      '.dshdt-config-hint{margin:0;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:13px;line-height:20px}',
      '.dshdt-danger{background:var(--dsw-alias-state-error-primary,#d54941)!important;color:var(--dsw-alias-label-primary-foreground,#fff)!important}',
      '@media (prefers-reduced-motion:reduce){.dshdt-collapsing{transition:none}.dshdt-floating{transition:none}}',
    ].join('')

    const TAG_ID = 'dsh-delete-turn/delete-turn.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // --- icon -----------------------------------------------------------------

    // Hand-drawn trash glyph: lid line, trapezoid body, two ribs.
    const ICON_PATHS = [
      'M6.4 2.6h3.2',
      'M2.9 4.6h10.2',
      'M4.4 4.6l.62 7.55A1.6 1.6 0 0 0 6.61 13.6h2.78a1.6 1.6 0 0 0 1.59-1.45l.62-7.55',
      'M6.8 7.1v3.6',
      'M9.2 7.1v3.6',
    ]
    const ICON_MARKUP =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      ICON_PATHS.map(
        (d) =>
          '<path d="' + d + '" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
      ).join('') +
      '</svg>'

    // Collapse glyph: a centre rail with one arrow above and one below, both
    // pointing at it - "the neighbours move up into this one's place".
    const TURN_ICON_PATHS = [
      'M3.2 8h9.6',
      'M8 2.4v4',
      'M6.3 4.7L8 6.4l1.7-1.7',
      'M8 13.6v-4',
      'M6.3 11.3L8 9.6l1.7 1.7',
    ]
    const TURN_ICON_MARKUP =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      TURN_ICON_PATHS.map(
        (d) =>
          '<path d="' + d + '" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
      ).join('') +
      '</svg>'

    // Multi-select glyph: a checkbox square with a tick.
    const CHECK_ICON_PATHS = ['M2.7 2.7h10.6v10.6H2.7z', 'M5.3 8.15l1.95 2 3.5-4.05']
    const CHECK_ICON_MARKUP =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      CHECK_ICON_PATHS.map(
        (d) =>
          '<path d="' + d + '" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
      ).join('') +
      '</svg>'

    function TrashIcon() {
      return jsx('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        children: ICON_PATHS.map((d, index) =>
          jsx('path', { d, stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, index),
        ),
      })
    }

    // The multi-select mark: a checkbox square with a tick, so the header entry
    // reads as "select rows" rather than "delete".
    function CheckIcon() {
      return jsx('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        children: CHECK_ICON_PATHS.map((d, index) =>
          jsx('path', { d, stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, index),
        ),
      })
    }

    // --- controller -----------------------------------------------------------

    class DeletionController {
      constructor(sessionId) {
        this.sessionId = sessionId
        this.listeners = new Set()
        this.inflight = null
        this.animateOnce = false
        this.view = Object.freeze({
          hidden: new Map(),
          // replacement seq -> the seq it was recorded as shadowing. See hiddenViaOf.
          hiddenVia: new Map(),
          surface: new Set(),
          // The seqs the host would accept a turn-delete for (advertised, not
          // guessed): the entry appears only on those rows.
          turnSeqs: new Set(),
          replyTurns: new Set(),
          edits: new Map(),
          markerTurns: new Set(),
          surfaceReady: false,
          surfaceThrough: -1,
          // The host reports a running turn (or a compaction) so the dialog can
          // say that a delete will stop the generation first.
          busy: false,
          loaded: false,
          loadError: false,
          dialog: null,
          // Multi-select: while `selecting` is on every deletable row offers a
          // checkbox, and one request lands every checked window at once.
          selecting: false,
          // selectionKey -> target, so a row keeps its mark across refreshes.
          selected: new Map(),
          pending: false,
          failure: null,
          // How many unrelated nodes the last attempt reported it would also
          // remove (the forced-confirmation prompt).
          foreignCount: 0,
          revision: 0,
        })
      }

      getSnapshot = () => this.view

      subscribe = (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      }

      publish(patch) {
        this.view = Object.freeze({ ...this.view, ...patch, revision: this.view.revision + 1 })
        for (const listener of this.listeners) {
          try {
            listener()
          } catch (error) {
            console.error('[dsh-delete-turn] subscriber threw:', error)
          }
        }
      }

      consumeAnimate() {
        const value = this.animateOnce === true
        this.animateOnce = false
        return value
      }

      // Refresh the snapshot when the transcript shows events newer than the
      // last read. Throttled: a streaming turn produces many new seqs, and one
      // read per interval is enough for the ledger and the gates.
      requestRefresh() {
        if (this.inflight !== null) return
        const since = typeof this.refreshedAt === 'number' ? Date.now() - this.refreshedAt : Infinity
        if (since < REFRESH_INTERVAL_MS) return
        this.load(true)
      }

      load(force) {
        if (this.inflight !== null) return this.inflight
        if (this.view.loaded && force !== true) return Promise.resolve()
        this.refreshedAt = Date.now()
        const url = `${ROUTE_PREFIX}/state?sessionId=${encodeURIComponent(this.sessionId)}`
        const pending = fetch(url, { headers: { accept: 'application/json' } })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.ok) throw new Error(data && data.error ? String(data.error) : `HTTP ${res.status}`)
            const hidden = new Map()
            for (const item of Array.isArray(data.hidden) ? data.hidden : []) {
              if (item && typeof item.seq === 'number') hidden.set(item.seq, typeof item.mode === 'string' ? item.mode : 'message')
            }
            const hiddenVia = hiddenViaOf(data.hidden)
            const surface = new Set()
            for (const seq of Array.isArray(data.surface) ? data.surface : []) surface.add(seq)
            const turnSeqs = new Set()
            for (const seq of Array.isArray(data.turnSeqs) ? data.turnSeqs : []) turnSeqs.add(seq)
            const replyTurns = new Set()
            for (const turn of Array.isArray(data.replyTurns) ? data.replyTurns : []) replyTurns.add(turn)
            const edits = new Map()
            for (const pair of Array.isArray(data.edits) ? data.edits : []) {
              if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') edits.set(pair[0], pair[1])
            }
            const markerTurns = new Set()
            for (const turn of Array.isArray(data.markerTurns) ? data.markerTurns : []) {
              if (typeof turn === 'number') markerTurns.add(turn)
            }
            // 消息 id → seq：snapshot 缺行时按 key 里的 id 反查（官方的复制在，
            // 我们的删除就也该在）。
            const ids = {}
            if (data.ids !== null && typeof data.ids === 'object') {
              for (const [id, seq] of Object.entries(data.ids)) {
                if (typeof seq === 'number') ids[id] = seq
              }
            }
            const surfaceThrough = typeof data.lastSeq === 'number' ? data.lastSeq : -1
            this.publish({ hidden, hiddenVia, surface, turnSeqs, replyTurns, edits, markerTurns, ids, busy: data.busy === true, surfaceReady: true, surfaceThrough, loaded: true, loadError: false })
          })
          .catch(() => {
            this.publish({ loadError: true })
          })
          .finally(() => {
            this.inflight = null
          })
        this.inflight = pending
        return pending
      }

      /**
       * 撤回一条还没落盘的排队消息（宿主的输入队列）。
       *
       * @param {string} key - 行的 flow key。
       * @returns {Promise<void>} 撤回完成。
       */
      async recallQueue(key) {
        const response = await fetch(`${ROUTE_PREFIX}/queue-remove`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId, key }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.ok) throw new Error(data && data.error ? String(data.error) : `HTTP ${response.status}`)
      }

      // Entering/leaving multi-select. Leaving drops the selection, so a later
      // entry never starts with rows the user no longer sees as marked.
      setSelecting(on) {
        if (this.view.pending) return
        const selecting = on === true
        if (selecting === this.view.selecting) return
        this.publish({ selecting, selected: selecting ? this.view.selected : new Map(), dialog: null, failure: null, foreignCount: 0 })
      }

      toggleSelected(key, target) {
        if (this.view.pending || typeof key !== 'string' || key === '' || target === null || target === undefined) return
        const selected = new Map(this.view.selected)
        if (selected.has(key)) selected.delete(key)
        else selected.set(key, target)
        this.publish({ selected })
      }

      // The batch entry: with "ask" on it opens the confirmation dialog, with it
      // off it deletes straight away and only surfaces a dialog when the attempt
      // failed (a silent failure would have nowhere to go).
      requestBatch() {
        const count = this.view.selected.size
        if (count === 0 || this.view.pending) return
        if (getPrefs().ask) {
          this.publish({ dialog: { mode: 'batch', count }, failure: null, foreignCount: 0 })
          return
        }
        void this.performBatch().then((result) => {
          if (result.failure !== null) this.publish({ dialog: { mode: 'batch', count }, pending: false, failure: result.failure })
        })
      }

      // One request carries every selected target. The host fuses the windows
      // and lands them back to back, so a batch can never land half of itself.
      async performBatch(options) {
        if (this.view.pending) return { failure: null }
        const force = options !== undefined && options.force === true
        const requested = [...this.view.selected.values()]
        if (requested.length === 0) return { failure: null }
        this.publish({ pending: true, failure: null, foreignCount: 0 })
        try {
          await this.load(true)
          // A target the fresh surface no longer holds means the log moved under
          // the selection: refuse the whole batch instead of landing the part
          // that still resolves.
          const resolved = requested.map((target) => this.resolveTarget(target))
          if (resolved.some((target) => target === null || target === undefined)) {
            this.publish({ pending: false, failure: 'stale' })
            return { failure: 'stale' }
          }
          const targets = resolved.map((target) => {
            const out = { mode: target.mode }
            if (typeof target.seq === 'number') out.seq = target.seq
            if (typeof target.turn === 'number') out.turn = target.turn
            if (typeof target.messageId === 'string') out.messageId = target.messageId
            return out
          })
          const res = await fetch(`${ROUTE_PREFIX}/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: this.sessionId, targets, ...(force ? { force: true } : {}) }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) {
            const code = data && data.code ? String(data.code) : 'generic'
            const foreignCount = data && data.details && typeof data.details.foreign === 'number' ? data.details.foreign : 0
            this.publish({ pending: false, failure: code, foreignCount })
            // `partial` means the log moved between two appends: re-read so the
            // transcript shows what actually landed, not the pre-batch picture.
            if (code === 'partial') await this.load(true)
            return { failure: code }
          }
          const hidden = new Map(this.view.hidden)
          for (const item of Array.isArray(data.hidden) ? data.hidden : []) {
            if (item && typeof item.seq === 'number') hidden.set(item.seq, typeof item.mode === 'string' ? item.mode : 'message')
          }
          const hiddenVia = new Map(this.view.hiddenVia)
          for (const [via, seq] of hiddenViaOf(data.hidden)) hiddenVia.set(via, seq)
          this.animateOnce = true
          // Leaving the mode after a landed batch keeps the next click an
          // ordinary delete: the marks are gone, so staying would only widen it.
          this.publish({ pending: false, selecting: false, dialog: null, hidden, hiddenVia, selected: new Map(), loaded: true, loadError: false })
          return { failure: null }
        } catch {
          this.publish({ pending: false, failure: 'generic' })
          return { failure: 'generic' }
        }
      }

      open(target) {
        this.load()
        this.publish({ dialog: target, failure: null })
      }

      close() {
        if (this.view.pending) return
        this.publish({ dialog: null, failure: null, foreignCount: 0 })
      }

      // `force` re-submits after the "the window also swallows N unrelated
      // nodes" report, which is the only refusal the dialog turns into a second
      // question instead of a dead end.
      async confirm(options) {
        const force = options !== undefined && options.force === true
        const target = this.view.dialog
        if (target !== null && typeof target === 'object' && target.mode === 'batch') {
          await this.performBatch({ force })
          return
        }
        await this.perform(target, { force })
      }

      // The entry every action uses. With "ask" on, it opens the confirmation
      // dialog as before. With it off, it deletes straight away - and since a
      // silent failure would have nowhere to surface, a failed attempt opens the
      // dialog carrying its error so the user can retry or cancel.
      async trigger(target) {
        if (target === null || target === undefined || this.view.pending) return
        if (getPrefs().ask) {
          this.open(target)
          return
        }
        const result = await this.perform(target)
        if (result.failure !== null) this.publish({ dialog: target, pending: false, failure: result.failure })
      }

      async perform(requested, options) {
        if (requested === null || this.view.pending) return { failure: null }
        const force = options !== undefined && options.force === true
        this.publish({ pending: true, failure: null, foreignCount: 0 })
        try {
          // The live node can move while the dialog sits open: another producer
          // (dsh-edit-turn) rewrites the message in place, and the replacement
          // this row pointed at is shadowed by the time we submit. Re-read the
          // snapshot, aim at the current chain head, and retry once when the
          // first attempt reports content that has already left the context.
          await this.load(true)
          let target = this.resolveTarget(requested)
          let result = await this.deleteOnce(target, force)
          if (!result.ok && result.code === 'already-deleted') {
            await this.load(true)
            const next = this.resolveTarget(target)
            if (next.seq !== target.seq) {
              target = next
              result = await this.deleteOnce(next, force)
            }
          }
          if (!result.ok) {
            const foreignCount = result.details && typeof result.details.foreign === 'number' ? result.details.foreign : 0
            this.publish({ pending: false, failure: result.code, foreignCount })
            return { failure: result.code }
          }
          const data = result.data
          const hidden = new Map(this.view.hidden)
          for (const item of Array.isArray(data.hidden) ? data.hidden : []) {
            if (item && typeof item.seq === 'number') hidden.set(item.seq, typeof item.mode === 'string' ? item.mode : target.mode)
          }
          const hiddenVia = new Map(this.view.hiddenVia)
          for (const [via, seq] of hiddenViaOf(data.hidden)) hiddenVia.set(via, seq)
          this.animateOnce = true
          this.publish({ pending: false, dialog: null, hidden, hiddenVia, loaded: true, loadError: false })
          return { failure: null }
        } catch {
          this.publish({ pending: false, failure: 'generic' })
          return { failure: 'generic' }
        }
      }

      // Map a dialog target onto the current chain head, so a row that another
      // producer rewrote in place is deleted through its live replacement.
      resolveTarget(target) {
        if (!target || typeof target.seq !== 'number' || this.view.edits.size === 0) return target
        const chain = chainSeqs(target.seq, this.view.edits)
        const seq = chain[chain.length - 1]
        return seq === target.seq ? target : { ...target, seq }
      }

      async deleteOnce(target, force) {
        const res = await fetch(`${ROUTE_PREFIX}/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId, ...target, ...(force === true ? { force: true } : {}) }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) return { ok: true, data }
        return {
          ok: false,
          code: data && data.code ? String(data.code) : 'generic',
          details: data && data.details ? data.details : undefined,
        }
      }

      dispose() {
        this.listeners.clear()
      }
    }

    // --- row targets ----------------------------------------------------------

    // What one Chat view node can be asked to delete, or null when the row has
    // no deletable target (system prompt head, running step, ...).
    function targetFor(node) {
      const data = node.data || {}
      switch (node.kind) {
        case 'user':
        case 'context':
        case 'steering': {
          const seq = typeof data.seq === 'number' ? data.seq : node.anchorSeq
          return typeof seq === 'number' ? { mode: 'message', seq, label: 'message' } : null
        }
        case 'tool-call': {
          const root = data.root
          const seq = root && typeof root.seq === 'number' ? root.seq : undefined
          return seq === undefined ? null : { mode: 'step', seq, label: 'step' }
        }
        // The process/disclosure row ("已思考", "用时 N 秒") deliberately gets no
        // entry: the same whole-reply delete already lives in the turn tail's
        // official action strip, so a second hover-only icon there would only
        // duplicate the same scope.
        case 'turn-error':
        case 'model-retry':
          return typeof data.turn === 'number' ? { mode: 'reply', turn: data.turn, label: 'reply' } : null
        case 'turn-tail': {
          const closing = data.closing
          if (closing && closing.finalNode && closing.finalNode.messageId !== undefined) return null
          return typeof data.turn === 'number' ? { mode: 'reply', turn: data.turn, label: 'reply' } : null
        }
        case 'assistant-step': {
          const final = data.finalNode
          if (final && final.messageId !== undefined) return null
          return final && typeof final.seq === 'number' ? { mode: 'step', seq: final.seq, label: 'step' } : null
        }
        default:
          return null
      }
    }

    // The second entry: delete the WHOLE turn the row belongs to - the prompt
    // included - as one range replace. Only a human prompt anchors it; an
    // injected context row or a reply row is not the turn's own question.
    function turnTargetFor(node) {
      if (node.kind !== 'user') return null
      const data = node.data || {}
      const seq = typeof data.seq === 'number' ? data.seq : node.anchorSeq
      return typeof seq === 'number' ? { mode: 'turn', seq, label: 'turn' } : null
    }

    // Stable identity of one selectable target across snapshot refreshes: a
    // message/step addresses a durable seq, a reply/turn a turn number. The key
    // is what the controller keys its selection map by, so a re-read that moves
    // a row's live seq cannot silently keep a stale mark.
    function selectionKey(target) {
      if (!target || typeof target !== 'object') return ''
      if (typeof target.seq === 'number') return target.mode + ':' + String(target.seq)
      if (typeof target.turn === 'number') return target.mode + ':t' + String(target.turn)
      if (typeof target.messageId === 'string') return target.mode + ':m' + target.messageId
      return ''
    }

    function seqsFor(node) {
      const data = node.data || {}
      const out = []
      const push = (value) => {
        if (typeof value === 'number' && !out.includes(value)) out.push(value)
      }
      switch (node.kind) {
        case 'user':
        case 'context':
        case 'steering':
          push(data.seq)
          break
        case 'assistant-step':
          push(node.anchorSeq)
          if (data.finalNode) push(data.finalNode.seq)
          break
        case 'tool-call':
          if (data.root) push(data.root.seq)
          break
        case 'turn-tail':
          push(node.anchorSeq)
          if (data.closing && data.closing.finalNode) push(data.closing.finalNode.seq)
          break
        case 'turn-process':
          // The process disclosure hides with its answer: a step deletion that
          // leaves the answer keeps the row, a reply deletion that removes the
          // answer collapses it.
          push(data.answerAnchorSeq)
          break
        default:
          push(node.anchorSeq)
      }
      return out
    }

    // Process group rows use the composite key `["process", anchorMemberKey,
    // part]` (ui-chat's ProcessState). The second element names the member node
    // the group is anchored to, which is the node the group row must follow.
    function groupAnchorKey(key) {
      if (!key.startsWith('["process"')) return undefined
      try {
        const parsed = JSON.parse(key)
        if (Array.isArray(parsed) && parsed[0] === 'process' && typeof parsed[1] === 'string') return parsed[1]
      } catch {
        // not a composite key
      }
      return undefined
    }

    // Other producers can rewrite a message in place through a replacement
    // (dsh-edit-turn does this for an edited message). The transcript row then
    // stays anchored to the original seq while the model context holds the
    // replacement, so the host exposes `edits: from -> to`. A row is live while
    // any seq of its chain is on the surface, and an action must address the
    // chain head.
    function chainSeqs(seq, edits) {
      const out = [seq]
      const seen = new Set([seq])
      let current = seq
      for (let hop = 0; hop < 64; hop += 1) {
        const next = edits.get(current)
        if (typeof next !== 'number' || seen.has(next)) break
        out.push(next)
        seen.add(next)
        current = next
      }
      return out
    }

    function expandSeqs(seqs, edits) {
      if (edits.size === 0) return seqs
      const out = []
      for (const seq of seqs) {
        for (const value of chainSeqs(seq, edits)) {
          if (!out.includes(value)) out.push(value)
        }
      }
      return out
    }

    function liveTarget(target, edits) {
      if (!target || typeof target.seq !== 'number' || edits.size === 0) return target
      const chain = chainSeqs(target.seq, edits)
      const seq = chain[chain.length - 1]
      return seq === target.seq ? target : { ...target, seq }
    }

    // Index a deletion by the REPLACEMENT it landed, not only by the seq it
    // shadowed. A deleted message leaves a carrier standing in its row, and the
    // transcript row names the live node (the carrier), so a row checked against
    // 'hidden' alone never matches: the deletion succeeds, the model context
    // loses the message, and the row is simply never hidden - an empty bubble
    // left behind. The link is already on every hidden entry ('replacement'), so
    // it is indexed here rather than derived from 'edits': that chain
    // deliberately excludes this plugin's own carriers (they rewrite context,
    // not content) and so cannot bridge the gap.
    function hiddenViaOf(items) {
      const via = new Map()
      for (const item of Array.isArray(items) ? items : []) {
        if (item && typeof item.seq === 'number' && typeof item.replacement === 'number') via.set(item.replacement, item.seq)
      }
      return via
    }

    function isRowHidden(hidden, hiddenVia, seqs) {
      for (const seq of seqs) {
        if (hidden.has(seq)) return true
        if (hiddenVia !== undefined && hiddenVia.has(seq)) return true
      }
      return false
    }

    // --- dom enhancement ------------------------------------------------------

    // Every node this plugin injects carries its own namespace attribute
    // (interop contract I3). Two lookups depend on it: an injection adopts the
    // host an earlier apply left in the row instead of stacking a second button
    // beside it, and a dispose finds its own nodes again. A WeakMap can do
    // neither job on its own - it dies with the module instance while the DOM
    // does not, and a re-apply (HMR, plugin toggle, bundle-group reload) starts
    // with fresh module state over the very same page.
    const HOST_MARK = 'data-dshdt-action-host'
    const TURN_CLASS = 'dshdt-turn'
    const THINK_MARK = 'data-dshdt-think-action'
    const HOST_CLASS = 'dshdt-action-host'
    const THINK_CLASS = 'dshdt-think-action'

    let rowActions = new WeakMap()
    let thinkActions = new WeakMap()

    function isThinkHost(host) {
      return host.getAttribute(THINK_MARK) === '1' || host.classList.contains(THINK_CLASS)
    }

    // Our own host inside `scope` (a message row, a reasoning card), when an
    // earlier apply left one behind. The namespace attribute is the lookup the
    // injector must run before building anything; the class is the fallback for
    // a host injected by a build that predates the attribute, so an upgrade
    // adopts that one too instead of stacking a ghost next to it. Only nodes
    // carrying this plugin's own attribute or class can ever match (I3).
    function findOwnedHost(scope, wantThink) {
      for (const host of scope.querySelectorAll('[' + HOST_MARK + '="1"]')) {
        if (isThinkHost(host) === wantThink) return host
      }
      for (const host of scope.querySelectorAll('.' + HOST_CLASS)) {
        if (isThinkHost(host) === wantThink) return host
      }
      return null
    }

    // Reuse `host` - stamping the namespace on a node an older build left, and
    // rebuilding a button it lost - or build the host this injection needs.
    function adoptHost(host, kind) {
      if (host === null) host = document.createElement('span')
      host.className = kind === 'think' ? HOST_CLASS + ' ' + THINK_CLASS : HOST_CLASS
      host.setAttribute(HOST_MARK, '1')
      if (kind === 'think') host.setAttribute(THINK_MARK, '1')
      let button = host.querySelector('button.dshdt-action')
      if (button === null) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'dshdt-action dshdt-row-action'
        button.innerHTML = ICON_MARKUP
        host.appendChild(button)
      }
      // The row host carries this plugin's second action as well: delete the
      // whole turn. It rides in the SAME host -
      // the trash action's namespace, its selector and its one-host-per-row
      // contract are untouched - under its own class, and the reasoning host
      // never gets one (a reasoning card owns no turn).
      let turn = null
      if (kind !== 'think') {
        turn = host.querySelector('.' + TURN_CLASS)
        if (turn === null) {
          turn = document.createElement('button')
          turn.type = 'button'
          turn.className = TURN_CLASS + ' dshdt-row-action'
          turn.innerHTML = TURN_ICON_MARKUP
          host.appendChild(turn)
        }
      }
      // The multi-select checkbox rides in the same host (same namespace, same
      // adoption rule); it is only ever VISIBLE while the mode is on.
      let check = null
      if (kind !== 'think') {
        check = host.querySelector('.dshdt-check')
        if (check === null) {
          check = document.createElement('button')
          check.type = 'button'
          check.className = 'dshdt-check dshdt-row-action'
          check.innerHTML = CHECK_ICON_MARKUP
          host.appendChild(check)
        }
      }
      return { host, button, turn, check }
    }

    // Drop every node this plugin injected. Matched through this plugin's own
    // namespace, never by position: the host's own buttons, a sibling plugin's
    // nodes and the React-rendered overlay are not ours to remove (I3). Nodes
    // React owns are deliberately left alone - removing one behind React's back
    // breaks its own unmount. The style tag stays too: it is deduplicated by its
    // own marker further up, and dropping it here would strip the CSS from an
    // instance that has already re-applied.
    function sweepInjectedNodes() {
      for (const host of document.querySelectorAll('[' + HOST_MARK + '="1"]')) host.remove()
      for (const host of document.querySelectorAll('.' + HOST_CLASS)) host.remove()
      // A toggle parked on a row is not inside any host, so it is swept by name.
      for (const node of document.querySelectorAll('.dshdt-check')) node.remove()
      // These entries now point at detached nodes; the next injection re-adopts
      // from the DOM instead of trusting them.
      rowActions = new WeakMap()
      thinkActions = new WeakMap()
    }

    // Hidden-row attribution (interop contract §4). A row can be hidden by more
    // than one plugin, and each owner records its own claim on the row, so a
    // restore must only ever drop the claim this plugin owns. Clearing inline
    // display while another owner still holds the row would reveal content that
    // plugin deliberately hid (edit-turn / rerun-turn rewriting a row in place).
    const HIDE_OWNERS = [
      ['dshdt', 'data-dshdt-hidden', 'dshdtHidden'],
      ['dshet', 'data-dshet-hidden', 'dshetHidden'],
      ['dsrr', 'data-dsrr-hidden', 'dsrrHidden'],
    ]

    // Does a plugin other than the owner still declare this node hidden?
    function foreignHideOn(row, own) {
      for (const [key, attr, prop] of HIDE_OWNERS) {
        if (key === own) continue
        if (row.dataset && row.dataset[prop] === '1') return true
        if (typeof row.hasAttribute === 'function' && row.hasAttribute(attr)) return true
      }
      return false
    }

    function setRowHidden(row, hide, animate) {
      if (hide) {
        if (row.dataset.dshdtHidden === '1') return
        row.dataset.dshdtHidden = '1'
        if (!animate || typeof requestAnimationFrame !== 'function') {
          row.style.display = 'none'
          return
        }
        const height = row.getBoundingClientRect().height
        row.classList.add('dshdt-collapsing')
        row.style.height = `${height}px`
        row.style.opacity = '1'
        requestAnimationFrame(() => {
          row.style.height = '0px'
          row.style.opacity = '0'
          row.style.marginTop = '0px'
          row.style.marginBottom = '0px'
          row.style.paddingTop = '0px'
          row.style.paddingBottom = '0px'
        })
        window.setTimeout(() => {
          if (row.dataset.dshdtHidden !== '1') return
          row.classList.remove('dshdt-collapsing')
          row.style.display = 'none'
        }, 240)
        return
      }
      if (row.dataset.dshdtHidden !== '1') return
      delete row.dataset.dshdtHidden
      row.classList.remove('dshdt-collapsing')
      // Another component may still hold this row hidden: drop our own claim and
      // our collapse styles, but leave display:none in force until that owner
      // lifts its hide itself. Never reveal a row we do not own.
      row.style.display = foreignHideOn(row, 'dshdt') ? 'none' : ''
      row.style.height = ''
      row.style.opacity = ''
      row.style.marginTop = ''
      row.style.marginBottom = ''
      row.style.paddingTop = ''
      row.style.paddingBottom = ''
    }

    function removeRowAction(row) {
      const entry = rowActions.get(row)
      if (!entry) return
      entry.host.remove()
      // The toggle may be on the row rather than in the host while the mode is
      // on, so the row is swept of direct children that belong to the host.
      for (const node of row.querySelectorAll('.dshdt-check')) {
        if (node.parentElement === row) node.remove()
      }
      rowActions.delete(row)
      delete row.dataset.dshdtSelect
      row.classList.remove('dshdt-select-on', 'dshdt-checked')
    }

    function injectRowAction(row, node, target, turnTarget, view, controller, t, pickTarget) {
      // A row can carry the multi-select badge without carrying a hover action:
      // a turn's answer text has no row-level scope of its own, only a reply
      // scope, and that scope already lives in the reply action strip.
      const badgeOnly = target === null
      const pick = pickTarget === undefined || pickTarget === null ? target : pickTarget
      const label = badgeOnly ? '' : t(`action.tooltip.${target.label}`)
      let entry = rowActions.get(row)
      if (!entry) {
        // Never a second host on a row that already carries one: an earlier
        // apply's node is adopted as it is (no remove + re-insert, contract §5).
        entry = adoptHost(findOwnedHost(row, false), 'row')
        rowActions.set(row, entry)
      }
      const { host, button, turn, check } = entry
      if (badgeOnly) host.dataset.dshdtBadgeOnly = '1'
      else delete host.dataset.dshdtBadgeOnly
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label)
        button.setAttribute('title', label)
      }
      button.onclick = badgeOnly
        ? null
        : (event) => {
            event.preventDefault()
            event.stopPropagation()
            controller.trigger(target)
          }
      // The second action is wired only where a turn target exists (and stays
      // hidden by the row attribute otherwise), so a row can never offer an
      // operation the host would refuse for the wrong reason.
      if (!badgeOnly && turn !== null && turn !== undefined) {
        const turnLabel = t('action.tooltip.turn')
        if (turn.getAttribute('aria-label') !== turnLabel) {
          turn.setAttribute('aria-label', turnLabel)
          turn.setAttribute('title', turnLabel)
        }
        turn.onclick =
          turnTarget === null || turnTarget === undefined
            ? null
            : (event) => {
                event.preventDefault()
                event.stopPropagation()
                controller.trigger(turnTarget)
              }
      }
      // Multi-select: the same host carries the toggle. Outside selection mode
      // it enters the mode AND marks this row, so one click both opens the bar
      // and shows what the next click would do.
      if (check !== null && check !== undefined) {
        const key = selectionKey(pick)
        const selecting = view.selecting === true
        const selected = selecting && key !== '' && view.selected.has(key)
        if (selecting) {
          row.dataset.dshdtSelect = '1'
          row.classList.add('dshdt-select-on')
          // Physically move the node onto the row for the duration of the
          // mode; the same element and handler go back to the host after.
          if (check.parentElement !== row) row.appendChild(check)
        } else {
          delete row.dataset.dshdtSelect
          row.classList.remove('dshdt-select-on')
          if (check.parentElement !== host) host.appendChild(check)
        }
        if (selected) row.classList.add('dshdt-checked')
        else row.classList.remove('dshdt-checked')
        const checkLabel = selected ? t('action.tooltip.selected') : t('action.tooltip.select')
        if (check.getAttribute('aria-label') !== checkLabel) {
          check.setAttribute('aria-label', checkLabel)
          check.setAttribute('title', checkLabel)
        }
        check.setAttribute('aria-pressed', selected ? 'true' : 'false')
        check.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!controller.view.selecting) controller.setSelecting(true)
          controller.toggleSelected(key, pick)
        }
      }
      const anchor = node.kind === 'user' || node.kind === 'steering' ? row.querySelector('[class*="_actions"]') : null
      if (anchor) {
        host.classList.remove('dshdt-floating')
        row.classList.remove('dshdt-row')
        if (host.parentElement !== anchor) anchor.appendChild(host)
      } else {
        host.classList.add('dshdt-floating')
        row.classList.add('dshdt-row')
        if (host.parentElement !== row) row.appendChild(host)
      }
    }

    function removeThinkAction(think) {
      const entry = thinkActions.get(think)
      if (!entry) return
      entry.host.remove()
      thinkActions.delete(think)
    }

    // Reasoning rows live inside their assistant message: their action targets
    // the enclosing step, so a multi-step turn can drop one step's reasoning
    // and tool work without touching the other steps.
    function injectThinkAction(think, target, controller, t) {
      const label = t('action.tooltip.step')
      let entry = thinkActions.get(think)
      if (!entry) {
        // A reasoning card lives inside its message row, so the row lookup above
        // must not confuse the two: each kind adopts only its own host.
        entry = adoptHost(findOwnedHost(think, true), 'think')
        thinkActions.set(think, entry)
      }
      const { host, button } = entry
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label)
        button.setAttribute('title', label)
      }
      button.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        controller.trigger(target)
      }
      if (host.parentElement !== think) think.appendChild(host)
    }

    // A row may only offer an action while its content still exists in the
    // model context: compaction (or another producer) can remove a turn from
    // the surface while its transcript row stays visible on purpose.
    //
    // The state snapshot describes the session as of `surfaceThrough`. Rows
    // appended after that point (a message just sent in this session, before
    // the snapshot is refreshed) are NOT "missing from the surface" — they were
    // never covered by it — so they must stay actionable. The host still
    // validates every delete.
    function rowDeletable(node, seqs, view) {
      if (!view.surfaceReady) return true
      const data = node.data || {}
      const beyondSnapshot = (seq) => typeof seq === 'number' && typeof view.surfaceThrough === 'number' && seq > view.surfaceThrough
      if (seqs.length > 0 && seqs.every(beyondSnapshot)) return true
      if (node.kind === 'turn-tail' || node.kind === 'turn-process' || node.kind === 'turn-error' || node.kind === 'model-retry') {
        if (typeof data.turn === 'number') return view.replyTurns.has(data.turn)
      }
      return seqs.some((seq) => view.surface.has(seq))
    }

    function slotCoversRow(node) {
      if (node.kind !== 'turn-tail') return false
      const closing = node.data && node.data.closing
      return Boolean(closing && closing.finalNode && closing.finalNode.messageId !== undefined)
    }

    // Node kinds that carry visible conversation content, and the turn-level
    // disclosure rows that must go with them. A failure card ("处理失败"), a
    // process disclosure ("已思考", "用时 N 秒"), a retry notice or a turn tail is
    // drawn from the TURN, not from a surface node, so shadowing the nodes a
    // delete aimed at leaves it behind - a deleted failed turn keeps an orphaned
    // card. A turn is gone once none of its content rows is visible, and its
    // disclosure rows leave with it.
    const CONTENT_KINDS = new Set(['user', 'context', 'steering', 'tool-call', 'assistant-step'])
    const DISCLOSURE_KINDS = new Set(['turn-error', 'model-retry', 'turn-tail', 'turn-process'])

    /** 调试开关：`localStorage['dsh-delete-turn:debug'] = '1'` 时打印跳过原因。 */
    function debugOn() {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('dsh-delete-turn:debug') === '1'
      } catch {
        return false
      }
    }

    const debugSeen = new Set()

    /**
     * 打一条「这行为什么没有删除入口」的诊断；同一个 key 只打一次。
     *
     * @param {string} key - flow key。
     * @param {Element} row - 行元素。
     * @param {string} reason - 原因。
     */
    function debugSkip(key, row, reason) {
      if (!debugOn()) return
      const stamp = key + '|' + reason
      if (debugSeen.has(stamp)) return
      debugSeen.add(stamp)
      try {
        console.info('[dshdt] skip', {
          reason,
          key,
          flowKind: row.getAttribute('data-chat-flow-kind'),
          turn: row.getAttribute('data-chat-turn'),
          text: String(row.innerText ?? '').slice(0, 24),
        })
      } catch {
        // console 不可用就算了。
      }
    }

    const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    const USERISH_FLOW_KINDS = new Set(['user', 'steering', 'context'])

    /**
     * 从行 key 里恢复一个「用户消息」节点。
     *
     * snapshot 里没有这一行，不代表它不能删：官方的复制按钮就在同一行上。
     * 宿主没有把 seq 写到 DOM 上，但 flow-key 里通常带着消息 id——用 `/state`
     * 下发的 `ids`（id → seq）反查；再退一步，取 key 里落在 surface 上的数字。
     *
     * @param {string} key - `data-chat-flow-key`。
     * @param {object} view - 插件状态（含 ids / surface）。
     * @returns {object|null} 合成节点；恢复不出来时为 null。
     */
    function nodeFromKey(key, view) {
      if (typeof key !== 'string' || key === '') return null
      const ids = view !== null && view !== undefined && typeof view.ids === 'object' && view.ids !== null ? view.ids : {}
      for (const match of key.matchAll(UUID_PATTERN)) {
        const seq = ids[match[0]]
        if (typeof seq === 'number') return { kind: 'user', data: { seq }, anchorSeq: seq }
      }
      // key 里没有 id：取最大、且确实在表面上的数字（flow key 常见形态是
      // `["user", 72]` 或 `user-72`）。
      let best = -1
      for (const match of key.matchAll(/\d+/g)) {
        const value = Number(match[0])
        if (!Number.isSafeInteger(value)) continue
        if (view.surface instanceof Set && !view.surface.has(value)) continue
        if (value > best) best = value
      }
      return best >= 0 ? { kind: 'user', data: { seq: best }, anchorSeq: best } : null
    }

    function applyDom(snapshot, view, controller, t) {
      if (!snapshot || !snapshot.nodes || typeof snapshot.nodes.get !== 'function') return
      const animate = controller.consumeAnimate()
      const rows = document.querySelectorAll('[data-chat-flow-key]')
      let maxSeq = -1

      // Turns that still have a visible content row. Computed from the ledger
      // (not from DOM heights) so it is stable across the pass.
      const contentTurns = new Set()
      for (const row of rows) {
        const key = row.getAttribute('data-chat-flow-key')
        if (!key) continue
        const node = snapshot.nodes.get(key)
        if (!node || !CONTENT_KINDS.has(node.kind)) continue
        const turn = row.getAttribute('data-chat-turn')
        if (turn === null || turn === '') continue
        if (row.dataset.dshdtHidden === '1' || foreignHideOn(row, 'dshdt')) continue
        const seqs = expandSeqs(seqsFor(node), view.edits)
        if (isRowHidden(view.hidden, view.hiddenVia, seqs)) continue
        contentTurns.add(turn)
      }

      for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue
        const key = row.getAttribute('data-chat-flow-key')
        if (!key) continue
        // A deletion opens a bookkeeping turn to host its empty carrier; the
        // host still draws a process row for it, so hide the whole turn.
        const turn = row.getAttribute('data-chat-turn')
        if (turn !== null && view.markerTurns.has(Number(turn))) {
          setRowHidden(row, true, animate)
          removeRowAction(row)
          delete row.dataset.dshdtNoTarget
          continue
        }
        let node = snapshot.nodes.get(key)
        if (!node) {
          const flowKind = row.getAttribute('data-chat-flow-kind')
          const userish = flowKind === null || flowKind === '' || USERISH_FLOW_KINDS.has(flowKind)
          if (userish) node = nodeFromKey(key, view)
        }
        if (!node) {
          const flowKindName = row.getAttribute('data-chat-flow-kind')
          const pendingUserish = flowKindName === null || flowKindName === '' || USERISH_FLOW_KINDS.has(flowKindName)
          if (pendingUserish) {
            debugSkip(key, row, 'queued')
            injectQueueAction(row, key, controller)
            continue
          }
          debugSkip(key, row, 'no-node')
          // Process group rows carry a composite key ("["process", memberKey,
          // part]") and wrap ordinary member nodes. Hide the group together
          // with its anchor member, so deleting a turn's content leaves no
          // process chip behind.
          const anchorKey = groupAnchorKey(key)
          const anchor = anchorKey === undefined ? undefined : snapshot.nodes.get(anchorKey)
          if (anchor !== undefined) {
            const seqs = expandSeqs(seqsFor(anchor), view.edits)
            setRowHidden(row, isRowHidden(view.hidden, view.hiddenVia, seqs), animate)
          }
          continue
        }
        const seqs = expandSeqs(seqsFor(node), view.edits)
        for (const seq of seqs) if (typeof seq === 'number' && seq > maxSeq) maxSeq = seq
        // A disclosure row follows its turn: with no visible content row left,
        // it is an orphan and leaves too.
        const orphaned = DISCLOSURE_KINDS.has(node.kind) && turn !== null && turn !== '' && !contentTurns.has(turn)
        const hidden = orphaned || isRowHidden(view.hidden, view.hiddenVia, seqs)
        setRowHidden(row, hidden, animate)
        const target = hidden ? null : liveTarget(targetFor(node), view.edits)
        // A row with no scope of its own (the answer text of a turn) still earns
        // the badge when its turn's reply is deletable: ticking it deletes that
        // answer and keeps the prompt, which is the only scope the row owns.
        const turnNumber = turn === null || turn === '' ? null : Number(turn)
        const replyPick =
          !hidden && turnNumber !== null && Number.isFinite(turnNumber) && view.replyTurns.has(turnNumber)
            ? { mode: 'reply', turn: turnNumber, label: 'reply' }
            : null
        const covered = target !== null || slotCoversRow(node) || replyPick !== null
        const deletable = !hidden && covered && rowDeletable(node, seqs, view)
        // The turn-delete entry rides on the same gates as the delete entry: a
        // row whose content already left the context offers neither.
        const turnTarget =
          deletable && turnTargetFor(node) !== null && view.turnSeqs.has(target.seq) ? liveTarget(turnTargetFor(node), view.edits) : null
        const pickTarget = target !== null ? target : deletable ? replyPick : null
        if (deletable && pickTarget !== null) injectRowAction(row, node, target, turnTarget, view, controller, t, pickTarget)
        else {
          removeRowAction(row)
          debugSkip(key, row, hidden ? 'hidden' : target === null ? 'no-target' : !covered ? 'not-covered' : 'not-deletable')
        }
        if (deletable && target !== null && turnTarget !== null) row.dataset.dshdtTurn = '1'
        else delete row.dataset.dshdtTurn
        if (!hidden && covered && !rowDeletable(node, seqs, view)) row.dataset.dshdtNoTarget = '1'
        else delete row.dataset.dshdtNoTarget
      }
      for (const think of document.querySelectorAll('[data-variant="think"]')) {
        const row = think.closest('[data-chat-flow-key]')
        const node = row ? snapshot.nodes.get(row.getAttribute('data-chat-flow-key')) : undefined
        const final = node && node.kind === 'assistant-step' ? node.data.finalNode : undefined
        const seq = final && typeof final.seq === 'number' ? final.seq : undefined
        if (typeof seq === 'number' && seq > maxSeq) maxSeq = seq
        const beyondSnapshot = typeof seq === 'number' && view.surfaceReady && seq > view.surfaceThrough
        const allowed = seq !== undefined && !view.hidden.has(seq) && (!view.surfaceReady || view.surface.has(seq) || beyondSnapshot)
        if (!allowed) removeThinkAction(think)
        else injectThinkAction(think, { mode: 'step', seq, label: 'step' }, controller, t)
      }
      // The state snapshot only covers events up to `surfaceThrough`; once the
      // transcript shows newer ones (a message just sent/streamed in this
      // session), refresh it so the ledger and the gates stay current.
      if (view.surfaceReady && maxSeq > view.surfaceThrough) controller.requestRefresh()
      updateTurnNavigation()
    }

    /**
     * 给「宿主画了、日志里还没有」的行注入撤回入口。
     *
     * 这类行是输入队列里的待发消息：有官方复制，没有 seq。删除它们要调宿主的
     * 队列接口，而不是写日志。
     *
     * @param {Element} row - 行元素。
     * @param {string} key - flow key（含消息 id）。
     * @param {object} controller - 控制器。
     */
    function injectQueueAction(row, key, controller) {
      let host = row.querySelector('.dshdt-queue-host')
      if (host === null) {
        host = document.createElement('span')
        host.className = 'dshdt-action-host dshdt-queue-host'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'dshdt-action dshdt-queue'
        button.setAttribute('aria-label', '撤回排队消息')
        button.title = '撤回排队消息'
        button.innerHTML = ICON_MARKUP
        if (typeof button.addEventListener === 'function') button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          void controller.recallQueue(key).then(
            () => {
              host.remove()
              row.style.display = 'none'
            },
            () => {
              button.title = '撤回失败：这条消息可能已经开始发送'
            },
          )
        })
        host.appendChild(button)
        row.appendChild(host)
      }
    }

    /** The turn a rail mark addresses: its label carries the real turn number. */
    function turnOfRailMark(mark) {
      const label = mark.getAttribute('aria-label') || mark.getAttribute('title') || ''
      const match = /(\d+)/.exec(label)
      return match === null ? null : Number(match[1])
    }

    /**
     * Every turn with a row in the DOM, mapped to whether any row is visible. A
     * turn with no row at all is absent: not empty, just not loaded.
     */
    function turnRowVisibility() {
      const seen = new Map()
      for (const row of document.querySelectorAll('[data-chat-flow-key][data-chat-turn]')) {
        const turn = Number(row.getAttribute('data-chat-turn'))
        if (!Number.isInteger(turn)) continue
        const hidden =
          row.dataset.dshdtHidden === '1' ||
          foreignHideOn(row, 'dshdt') ||
          (row.style !== undefined && row.style !== null && row.style.display === 'none') ||
          (typeof row.getBoundingClientRect === 'function' && row.getBoundingClientRect().height === 0)
        if (seen.get(turn) !== true) seen.set(turn, hidden !== true)
      }
      return seen
    }

    /**
     * The official rail keeps one mark per turn of the session, including the
     * turns whose rows are gone, so deleting a turn left a mark pointing at
     * nothing and an empty slot. Drop the marks of turns with no visible row and
     * re-space the rest inside the host's own ladder, centred; a turn that is
     * merely not loaded keeps its mark. The container keeps the host's height:
     * that height is what the host's virtualisation measures, so shrinking it
     * unmounts the marks past the new window.
     */
    function updateTurnNavigation() {
      const rows = turnRowVisibility()
      const hiddenTurns = []
      for (const [turn, visible] of rows) if (visible !== true) hiddenTurns.push(turn)
      for (const nav of document.querySelectorAll('nav')) {
        const marks = [...nav.querySelectorAll('button[data-index]')]
        if (marks.length === 0) continue
        const container = marks[0].parentElement
        if (container === null || container === undefined) continue
        const observed = Math.round((Number.parseFloat(container.style.height) - 2) / 10)
        const total = Math.max(Number.isFinite(observed) && observed > 0 ? observed : 0, marks.length)
        const kept = total - hiddenTurns.filter((turn) => turn <= total).length
        const offset = kept > 0 && kept < total ? Math.floor((total - kept) / 2) : 0
        for (const mark of marks) {
          const turn = turnOfRailMark(mark)
          if (turn === null) continue
          if (hiddenTurns.includes(turn)) {
            mark.dataset.dshdtHidden = '1'
            continue
          }
          delete mark.dataset.dshdtHidden
          const before = hiddenTurns.filter((hidden) => hidden < turn).length
          mark.style.transform = `translate3d(0px, ${(turn - 1 - before + offset) * 10 + 1}px, 0px)`
        }
      }
    }

    // --- react entries --------------------------------------------------------

    function AssistantAction({ messageId, useDeletion, controller, t }) {
      const view = useDeletion((state) => state)
      const label = t('action.tooltip.reply')
      return jsx('button', {
        type: 'button',
        className: 'dshdt-action',
        'aria-label': label,
        title: label,
        disabled: view.pending,
        onClick: () => controller.trigger({ mode: 'reply', messageId }),
        children: jsx(TrashIcon, {}),
      })
    }

    // The multi-select bar. Fixed placement keeps it out of the slot's layout:
    // `conversation.input.overlay` is drawn over the composer, so an in-flow bar
    // would push the input area around (and re-measure it) on every toggle.
    // Multi-select is a MODE: entering it has to be possible without hovering a
    // row first, so the entry lives in the Session header - always visible,
    // next to the other Session utilities. The per-row toggles only appear once
    // the mode is on (their rows carry `data-dshdt-select` then).
    function SelectToggle({ useDeletion, controller, t }) {
      const view = useDeletion((state) => state)
      const selecting = view.selecting === true
      const label = selecting ? t('select.cancel') : t('action.tooltip.select')
      return jsx('button', {
        type: 'button',
        className: selecting ? 'dshdt-header-select dshdt-header-select-on' : 'dshdt-header-select',
        'aria-label': label,
        'aria-pressed': selecting ? 'true' : 'false',
        title: label,
        disabled: view.pending,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          controller.setSelecting(!selecting)
        },
        children: jsx(CheckIcon, {}),
      })
    }

    function SelectionBar({ view, controller, t }) {
      if (view.selecting !== true) return null
      const count = view.selected.size
      return jsxs('div', {
        className: 'dshdt-selectbar',
        role: 'toolbar',
        children: [
          jsx('span', {
            className: 'dshdt-selectbar-count',
            children: `${t('select.count')} ${count}${t('select.unit')}`,
          }),
          jsx(primitives.Button, {
            variant: 'ghost',
            size: 'sm',
            disabled: view.pending,
            onClick: () => controller.setSelecting(false),
            children: t('select.cancel'),
          }),
          jsx(primitives.Button, {
            variant: 'primary',
            size: 'sm',
            className: 'dshdt-danger',
            disabled: view.pending || count === 0,
            onClick: () => controller.requestBatch(),
            children: view.pending ? t('dialog.pending') : t('select.delete'),
          }),
        ],
      })
    }

    function ConfirmDialog({ view, controller, t }) {
      const target = view.dialog
      const mode = target && typeof target.mode === 'string' ? target.mode : 'message'
      const failure = view.failure
      // The one refusal that is a question rather than a dead end: the window
      // also swallows N unrelated nodes. The button becomes an explicit
      // "delete them too", and confirming re-submits with `force`.
      const forced = failure === 'range-not-clean'
      return jsx(primitives.Modal, {
        open: target !== null,
        title: t(`dialog.title.${mode}`),
        closeLabel: t('dialog.cancel'),
        onClose: () => controller.close(),
        footer: jsxs(Fragment, {
          children: [
            jsx(primitives.Button, {
              variant: 'ghost',
              size: 'md',
              disabled: view.pending,
              onClick: () => controller.close(),
              children: t('dialog.cancel'),
            }),
            jsx(primitives.Button, {
              variant: 'primary',
              size: 'md',
              className: 'dshdt-danger',
              disabled: view.pending,
              onClick: () => controller.confirm(forced ? { force: true } : undefined),
              children: view.pending
                ? t('dialog.pending')
                : forced
                  ? t('dialog.confirmExtra')
                  : failure
                    ? t('dialog.retry')
                    : t('dialog.confirm'),
            }),
          ],
        }),
        children: jsxs(Fragment, {
          children: [
            jsx('p', { className: 'dshdt-dialog-text', children: t(`dialog.desc.${mode}`) }),
            jsx('p', { className: 'dshdt-dialog-note', children: t('dialog.note') }),
            view.busy ? jsx('p', { className: 'dshdt-dialog-warn', children: t('dialog.busyWarning') }) : null,
            forced
              ? jsx('p', {
                  className: 'dshdt-dialog-warn',
                  children: t('dialog.extraWarning') + (view.foreignCount > 0 ? ' ×' + String(view.foreignCount) : ''),
                })
              : null,
            failure === null || forced
              ? null
              : jsx('p', { className: 'dshdt-dialog-error', role: 'status', children: t(`error.${failure}`) }),
          ],
        }),
      })
    }

    // The plugin page entry (the component row's "configure" arrow, slot
    // `plugins.bundle.config`, key `<bundle>`). It renders the bundle page's
    // one-liner for the manager's summary slot and the toggle card for the page.
    function AskBeforeDeleteOption({ view, t }) {
      const tr = typeof t === 'function' ? t : (key) => key
      const [ask, setAsk] = react.useState(getPrefs().ask)
      react.useEffect(() => subscribePrefs(() => setAsk(getPrefs().ask)), [])
      if (view === 'summary') return tr(ask ? 'config.summary.ask' : 'config.summary.auto')
      return jsxs('div', {
        className: 'dshdt-config',
        children: [
          jsx(primitives.Checkbox, {
            checked: ask,
            label: tr('config.ask'),
            onChange: (checked) => setAskBeforeDelete(checked),
          }),
          jsx('p', { className: 'dshdt-config-hint', children: tr(ask ? 'config.hint.ask' : 'config.hint.auto') }),
        ],
      })
    }

    function OverlayEntry({ useChat, useDeletion, controller, t }) {
      const snapshot = typeof useChat === 'function' ? useChat((state) => state) : undefined
      const view = useDeletion((state) => state)

      react.useEffect(() => {
        controller.load()
      }, [controller])

      react.useEffect(() => {
        if (snapshot === undefined) return undefined
        let scheduled = false
        const run = () => {
          scheduled = false
          applyDom(snapshot, view, controller, t)
        }
        run()
        const observer = new MutationObserver(() => {
          if (scheduled) return
          scheduled = true
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
          else window.setTimeout(run, 16)
        })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
        }
      }, [snapshot, view, controller, t])

      return jsxs(Fragment, {
        // The slot root carries this plugin's namespace as well (I3). It is
        // React's node: the dispose sweep must not touch it.
        children: [
          jsx('span', { hidden: true, 'data-dshdt-overlay': '1' }),
          jsx(SelectionBar, { view, controller, t }),
          jsx(ConfirmDialog, { view, controller, t }),
        ],
      })
    }

    // --- plugin ---------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-delete-turn: dictionaries')

      const controllers = new Map()
      const controllerFor = (sessionId) => {
        let controller = controllers.get(sessionId)
        if (controller === undefined) {
          controller = new DeletionController(sessionId)
          controllers.set(sessionId, controller)
        }
        return controller
      }
      ctx.effect(
        () => () => {
          for (const controller of controllers.values()) controller.dispose()
          controllers.clear()
        },
        'dsh-delete-turn: per-session controllers',
      )

      // A re-apply runs over the page the previous apply already decorated. The
      // old nodes are still in the rows and the new module instance cannot see
      // them through its WeakMaps, so without this sweep every apply stacks one
      // more button per row. Only nodes carrying this plugin's own namespace are
      // removed (contract I3).
      ctx.effect(
        () => () => {
          sweepInjectedNodes()
        },
        'dsh-delete-turn: injected nodes',
      )

      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: 'delete-turn',
            order: 40,
            locale: NS,
            inject: (sessionId) => ({ hooks: { deletion: controllerFor(sessionId) }, controller: controllerFor(sessionId) }),
          },
          AssistantAction,
        ),
      )

      // The always-visible door into multi-select, beside the Session utilities.
      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'delete-turn',
            order: 10,
            locale: NS,
            inject: (sessionId) => ({ hooks: { deletion: controllerFor(sessionId) }, controller: controllerFor(sessionId) }),
          },
          SelectToggle,
        ),
      )


      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'delete-turn',
            order: 8,
            locale: NS,
            inject: (sessionId) => ({ hooks: { deletion: controllerFor(sessionId) }, controller: controllerFor(sessionId) }),
          },
          OverlayEntry,
        ),
      )


      // Bundled into dsh-optimizer: settings rendered in SectionPage below.
    }

    exports.apply = apply
    // The settings card, exported so a composing bundle (dsh-as-aistudio) can
    // render THE SAME component on its own page instead of re-implementing it:
    // one source of truth for 删除 settings.
    exports.ConfigCard = AskBeforeDeleteOption
    exports.inject = ['slots', 'locale']
    return module.exports
    }

		let vendorDeleteConfigCard = null

		/* ── registration ────────────────────────────────────────────────── */

		exports.inject = ['slots', 'locale']
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
			// The original upstream deletion module owns all message/step/reply/turn and batch controls.
			if (ctx.locale?.register && ctx.slots?.inject) {
				const deletion = makeVendoredDeleteClient(require)
				vendorDeleteConfigCard = deletion.ConfigCard
				deletion.apply(ctx)
			}
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
