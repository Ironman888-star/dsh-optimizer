/**
 * dsh-optimizer — Host entry.
 *
 * Deliberately declares NO object-level `inject`: the Host plugin is meant to
 * come up even when optional services are absent (an early boot, a headless
 * profile, a test double). `createHost` mounts each module into its own
 * `root.inject([...])` scope, so a missing `systemPrompt` or `tools` service
 * only disables that one feature.
 *
 * The plugin is inert without a Runtime: with `enabled: false` the
 * status/config routes and independently configured packing / task-guidance providers remain mounted.
 */
import { createHost, VERSION, PLUGIN_ID as ID } from './lib/host.js'

export const name = 'dsh-optimizer'
export const version = VERSION

export function apply(root) {
  let host = null
  try {
    host = createHost({ root })
  } catch (error) {
    // A boot failure must never take the Host down with it.
    try {
      root?.logger?.error?.('dsh-optimizer: createHost failed', error)
    } catch { /* ignore */ }
    return
  }

  try {
    if (typeof root?.effect === 'function') {
      root.effect(() => () => host.dispose(), 'dsh-optimizer: lifecycle')
    }
  } catch { /* ignore */ }

  try {
    host.start()
  } catch (error) {
    try { host.log?.error?.('dsh-optimizer: start failed', error) } catch { /* ignore */ }
  }

  return host
}

export default { name, version, apply }
export { createHost, ID }
