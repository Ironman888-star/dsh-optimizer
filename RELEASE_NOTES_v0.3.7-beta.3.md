# v0.3.7-beta.3 — startup crash fix for the integrated delete module (test build)

Date: 2026-11-15
Baseline: `v0.3.7-beta.2` (integrated `DDDMUC/dsh-delete-turn v0.2.7`)
Scope: **one file** — `lib/host.js`

## Why

`v0.3.7-beta.2` failed at plugin-tree load time on a real DSH host:

```
dsh: fatal uncaught exception: Error: dsh: plugin tree failed to load:
Maximum call stack size exceeded
  ... at bridge.get (…/lib/host.js:171:12)   ← self-recursion
```

The bridge passed to the vendored delete host was built as
`Object.create(ctx ?? null)` with its own `get` override. Because cordis resolves
services through a `get` accessor that uses the **receiver**, the bridge's `get`
called itself: `bridge.get → ctx.get → getTarget → Object.get → bridge.get …`
until the stack overflowed. beta.1 had no such bridge, which is why it never crashed.

## What changed

`lib/host.js` only:

1. **No prototype inheritance from ctx.** The bridge is now a plain object literal.
   The original `ctx` is kept in a closure as `owner`, and `ownerGet = owner.get.bind(owner)`
   is used so the receiver is always the real ctx.
2. **Explicit service proxying.** `get(name)` returns the web-server facade, else
   `ownerGet(name) ?? owner[name]`. `effect`, `inject`, `on`, `emit` and `logger`
   are provided explicitly; `inject` delegates to `owner.inject` when present and
   otherwise fills dependencies from the bridge synchronously.
3. **Failure isolation.** `applyVendoredDeleteTurn(bridge)` is wrapped in
   `try/catch`. If the vendored module cannot initialise, the disposer registered so
   far is rolled back, a `delete module unavailable; continuing without deletion`
   error is logged, and a dispose handle tagged `.degraded` is returned instead of
   aborting the whole plugin tree.
4. `mount()` maps `.degraded` to module state `failed` (with reason) instead of
   `mounted`, so the dashboard shows the real state.

**Not changed:** the upstream `dsh-delete-turn` algorithm
(`vendor/dsh-delete-turn/src/{index,logic,client}.js`), the beta.1 self-authored
deletion module (still removed), context packing, task instructions, ledger, budget,
checkpoints, anomaly detection. Every other file is byte-identical to beta.2; the
only diff against the beta.2 delivery is `lib/host.js`.

## Verification done on this build

- `node --check` on `lib/host.js` plus the package `check` script.
- Full automated regression suite (package tests + vendored delete-turn tests).
- Isolated DSH profile: plugin tree loads, optimizer routes mount (`routes mounted: 7`),
  `/dsh-delete-turn/state` answers `ok:true`, and the process survives repeated restarts
  with no `disposed`/stack-overflow in stderr.
- Real session deletion exercised over the HTTP surface: single message, assistant reply,
  whole turn and multi-select all append proper tombstones; hidden rows stay hidden after
  page reload and after a DSH restart.
- Native V4 cold replay (`verify-v4.mjs`) on the touched sessions: `ok:true`, file digest
  matches SHA-256.

## Still required before this can become stable

- Deletion of a **tool step** on a live session (needs a visible tool call/result pair).
- Queued-message recall under a genuinely in-flight turn.
- Joint run with recent-N-turn context packing over 6–8 fresh turns.
- Confirmation that the model payload — not only the UI — excludes deleted turns.

`v0.3.6` remains the field-validated stable release. This build is **not** published to
GitHub Releases and does not replace `v0.3.6` anywhere.

## Upgrade notes

Neither `v0.3.7-beta.2` nor this build may be installed alongside a standalone
`dsh-delete-turn` plugin: the bundle already contains that module, and a second copy
would duplicate routes and buttons. Replace, do not co-install.

Node ≥22 is required.
