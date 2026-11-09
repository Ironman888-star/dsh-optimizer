/**
 * Browser-half contract.
 *
 * `client.js` is not an ES module: it is a single
 * `window.__ModuleLoader__.load({id, factory(require)})` row that the shell
 * executes. A plain `import` would therefore fail, so this test reproduces the
 * loader handshake with a stub `window` + `require` and asserts the plugin
 * registers exactly the two slots it advertises.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

const REACT_METHODS = [
  'createElement', 'Fragment', 'useState', 'useEffect', 'useMemo', 'useCallback',
  'useRef', 'useReducer', 'useLayoutEffect',
]

function loadClient(options = {}) {
  const loaded = []
  const React = {}
  for (const name of REACT_METHODS) React[name] = () => null
  React.createElement = (type, props, ...children) => ({ type, props, children })
  React.Fragment = 'fragment'
  React.useState = options.useState ?? ((initial) => [typeof initial === 'function' ? initial() : initial, () => {}])
  React.useReducer = (reducer, initial) => [initial, () => {}]
  React.useMemo = (factory) => factory()
  React.useCallback = (fn) => fn
  React.useRef = (value) => ({ current: value })

  const requireStub = (id) => {
    if (id === 'react') return React
    throw new Error(`unexpected platform module: ${id}`)
  }
  const window = {
    __ModuleLoader__: {
      load: (definition) => {
        assert.equal(typeof definition.factory, 'function', 'loader receives a factory')
        loaded.push({ id: definition.id, exports: definition.factory(requireStub) })
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', source)(window)
  return { loaded, React }
}

test('client: registers itself through window.__ModuleLoader__ exactly once', () => {
  const { loaded } = loadClient()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-optimizer')
})

test('client: declares slots inject and an apply function', () => {
  const { loaded } = loadClient()
  const mod = loaded[0].exports
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(typeof mod.apply, 'function')
})

test('client: apply seats the settings page and the sidebar readout', () => {
  const { loaded } = loadClient()
  const injected = []
  const registrations = []
  const ctx = {
    slots: {
      inject: (slot, factory) => { injected.push(slot); factory() },
      register: (spec, component) => { registrations.push({ spec, component }); return () => {} },
    },
  }
  loaded[0].exports.apply(ctx)

  assert.deepEqual(injected, ['settings.section', 'sidebar.footer.action'])
  assert.equal(registrations.length, 2)

  const [page, readout] = registrations
  assert.equal(page.spec.name, 'settings.section')
  assert.equal(page.spec.id, 'dsh-optimizer')
  assert.equal(typeof page.spec.order, 'number')
  assert.equal(typeof page.component, 'function')
  assert.equal(page.spec.label(), '智能优化管家')

  assert.equal(readout.spec.name, 'sidebar.footer.action')
  assert.equal(readout.spec.id, 'dsh-optimizer')
  assert.equal(typeof readout.component, 'function')
  assert.notEqual(readout.spec.order, page.spec.order, 'sidebar order stays independent from the page order')
})

test('client: both components tolerate being called with only owner props', () => {
  const { loaded } = loadClient()
  const registrations = []
  const ctx = { slots: { inject: (slot, factory) => factory(), register: (spec, component) => { registrations.push(component); return () => {} } } }
  loaded[0].exports.apply(ctx)
  for (const component of registrations) {
    // React is stubbed, so a hook-using component returns a tree stub; the point
    // is that nothing throws and no undefined prop is dereferenced eagerly.
    assert.doesNotThrow(() => component({ close: () => {} }))
  }
})

// The permission-gate UI is deliberately absent; packing changes require one click only.
test('client: settings panel contains direct-save packing switch and editable task guidance', async () => {
  const state = {
    plugin: { version: '0.3.5', enabled: true, mode: 'enforce' },
    contextPacking: { enabled: false, maxHistoryTurns: 3, hookMounted: true },
    taskInstructions: { sectionMounted: true, defaultText: '原始预置' },
    config: { taskInstructions: { text: '原始预置' } },
  }
  let step = 0
  let phase = 'page'
  const { loaded } = loadClient({ useState: (initial) => {
    const index = step++
    if (phase === 'page' && index === 0) return [state, () => {}]
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  } })
  const registrations = []
  loaded[0].exports.apply({ slots: { inject: (_, cb) => cb(), register: (spec, component) => { registrations.push({ spec, component }); return () => {} } } })
  const page = registrations.find((x) => x.spec.name === 'settings.section').component
  const tree = page({})
  function walk(node, test, out = []) {
    if (!node || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    for (const child of node.children ?? []) walk(child, test, out)
    return out
  }
  assert.equal(walk(tree, x => x.type?.name === 'AccessGuardPanel').length, 0)
  const packing = walk(tree, x => x.type?.name === 'ContextPackingPanel')[0]
  const instructions = walk(tree, x => x.type?.name === 'TaskInstructionsPanel')[0]
  assert.ok(packing && instructions)
  phase = 'panel'
  step = 0
  const packingTree = packing.type(packing.props)
  const toggle = walk(packingTree, x => x.props?.role === 'switch')[0]
  assert.equal(toggle.props['aria-checked'], false)
  assert.equal(toggle.props.disabled, false)
  assert.equal(walk(packingTree, x => x.children?.includes('确认保存')).length, 0)
  const calls = []
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('ui-control-token.json')) return { ok: true, json: async () => ({ token: 'a'.repeat(64) }) }
      if (String(url).endsWith('action.json')) calls.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ ok: true }) }
    }
    await toggle.props.onClick()
    assert.equal(calls[0].name, 'setPackingConfig')
    assert.deepEqual(calls[0].payload, { enabled: true, maxHistoryTurns: 3 })
  } finally {
    globalThis.fetch = originalFetch
  }
  step = 0
  const guideTree = instructions.type(instructions.props)
  assert.ok(walk(guideTree, x => x.type === 'textarea' && x.props?.['aria-label'] === '编辑常用任务指令').length)
  assert.ok(source.includes('保存任务指令'))
  assert.ok(!source.includes('禁止 DSH 主动回顾历史会话和扫描工作区'))
})
