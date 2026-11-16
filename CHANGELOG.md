# Changelog / 版本记录

## [0.3.7] — 2026-11-16 — 正式版：整合上游删除模块（Release）

- 版本从 `0.3.7-beta.3` 晋升为正式 `0.3.7`；功能代码与 beta.3 完全一致（仅版本元数据、发行说明、校验文件更新）。
- 桌面端六项实机验收全部通过：① Electron 桌面壳界面正常（删除按钮/确认弹窗在位，`setDraft` 报错不复现）② 5 轮会话删中间轮，视图即时更新、模型上下文只剩 `D1/D2/D4/D5` ③ 刷新与全量重启后仍隐藏、其他内容完整 ④ 与「最近 N 轮上下文打包」联合运行正常，已被打包覆盖的轮次返回 `409 already-deleted` 安全拒绝 ⑤ 新建会话原生 V4 冷重载 `ok:true`、digest 与文件哈希一致、UUID 合法、无未知事件 ⑥ 费用/预算/检查点/任务指令/打包/设置持久化/插件启动均可，并完成插件卸载与重装回归。
- 已知问题（宿主侧）：纯 Web 客户端打开会话可能因宿主 `conversation.session` 插槽报 `TypeError: text.replace is not a function at DraftEditorRuntime.setDraft` 导致消息区空白；DSH 桌面端不复现，不影响删除按钮、确认弹窗与发送。发布决策中已作为已知问题接受。
- `v0.3.6` 保留为上一稳定版与回滚基线；本次不修改 DSH 核心、不重新编号既有会话事件。

## [0.3.7-beta.3] — 2026-11-15 — Startup crash fix for integrated delete module (test build)

- Fixed the plugin-tree load failure `Maximum call stack size exceeded` caused by the `lib/host.js` bridge built with `Object.create(ctx)` plus a `get` override; the bridge is now a plain object with a closure-bound `ownerGet`, so cordis `get` no longer recurses through its receiver.
- Added failure isolation: if the vendored delete module cannot initialise, its disposer is rolled back, the error is logged and the module is reported as `failed` instead of aborting the whole tree.
- Upstream `dsh-delete-turn` v0.2.7 algorithm untouched; beta.1 self-authored deletion stays removed; all other files identical to beta.2.
- Verified: package `check`/test suite, repeated cold starts on an isolated profile, real single-message / reply / whole-turn / multi-select deletion, hide persistence across reload and restart, native V4 cold replay. Tool-step deletion, queued recall and packing-joint runs still need a live model connection.
- `v0.3.6` remains stable; this build is not published to GitHub Releases.

## [0.3.7-beta.2] — 2026-11-15 — Original dsh-delete-turn integration (test build)

- Removed beta.1's self-authored `lib/turn-delete.js`, old optimizer `/turns/*` routes and custom chat buttons.
- Vendored **DDDMUC/dsh-delete-turn v0.2.7**, MIT, and wired its original host routes and client widgets into the single `dsh-optimizer` bundle.
- Restored upstream single-message, tool-step, assistant-reply, whole-turn, multi-select and queued-message deletion, plus per-session UI state reconstruction.
- Added explicit upstream attribution and integration tests, including UUID validation and route disposal.
- v0.3.6 stays the field-validated stable release; cold V4 replay and UI behavior require DSH Desktop testing.

## [0.3.7-beta.1] — 2026-11-14 — Experimental explicit turn deletion

- New independent `lib/turn-delete.js` module with one-shot local POST, explicit confirmation, identified surface replacement, `sessions.flush()` durability barrier, and replay-derived hidden history.
- Client: official assistant-actions slot, session-header turn manager, and keyed user-row action enhancement.
- Safety: reject open/incomplete turns, protected system/developer messages, incomplete tool chains, stale requests, and foreign nodes.
- Does **not** delete physical `.zstd` logs or alter existing context-packing policy.
- **Beta only:** real DSH Desktop interaction and V4 cold-reload acceptance are pending. See [beta test guide](docs/turn-delete-beta.md).


## [0.3.6] — 2026-11-09 — Session identity hotfix / 会话身份修复

### Fixed

- `lib/context-packing.js`: every `user/message` replacement marker now contains a unique `data.id` generated via `crypto.randomUUID()`. This prevents **new** anonymous replacement events from corrupting DSH V4 session replay.
- Added strict message-identity regression coverage; local automated tests: **131/131 passed**.

### Unchanged

- The plugin ID `dsh-optimizer`, context-packing by recent completed turns (1–20, default off with default count 3), task guidance, budget and ledger accounting, checkpoints, and tool-output shaping.

### Upgrade warning

- Version 0.3.5 may already have written invalid event records to persistent sessions. **Upgrading to 0.3.6 does not rewrite existing sessions.** Back up complete session directories and use the corresponding DSH V4 persistence validation process before any manual repair; see [incident notes](docs/session-identity-fix.md).
- During public-source preparation, behavior and algorithms were preserved; the only change under `lib/` was normalizing the five default task-guidance item numbers to `1–5`, matching the reported field-tested manual adjustment. Tests and all other runtime files were retained byte-for-byte. Documentation and publishing metadata were prepared separately.

### Field validation

- A user-provided field report for DSH `2.0.21-next` shows 14/14 replacement markers with UUIDs, 12 turns with packing on (2-turn setting), and successful native V4 reload after restarting DSH. Private session identifiers and logs are intentionally omitted; see [summary](docs/field-validation.md).

## [0.3.5] — 2026-11-09 — Task guidance / 任务指令

- Added user-editable task guidance and DSH `systemPrompt.section` registration.
- Simplified context-packing switch to save immediately.
- Removed the former separate history/workspace tool-permission guard and owner approval interface.
- **Known issue:** context-packing replacement markers lacked required message identities, fixed in 0.3.6. **Do not publish or newly deploy v0.3.5.**

## Earlier internal development milestones

- **0.3.4:** conservative cleanup of confirmed obsolete in-history system-prompt snapshots.
- **0.3.3:** node-level history trimming instead of whole-turn protection.
- **0.3.2:** removed the experimental Token/hybrid packing modes, leaving turn-count only.
- **0.3.1:** skip unsafe trimming without blocking the whole conversation.
- **0.3.0:** initial experimental turn-based model-visible history packing.

These were internal development and acceptance milestones, **not claims that they were previously released as public GitHub tags**.
