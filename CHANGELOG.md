# Changelog / 版本记录

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
