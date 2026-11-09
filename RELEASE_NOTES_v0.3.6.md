# DSH Optimizer v0.3.6 — GitHub Release Notes

**发布状态 / Status:** Public release candidate. Publication requires maintainer confirmation of source copyrights, identity, and target Git repository. This file is a proposed release description; it is not evidence of a GitHub release already being live.

## What changed / 更新内容

- Fixed a critical DSH V4 session persistence defect: the context-packing plugin now assigns a fresh UUID to the `data.id` field of every newly generated `user/message` replacement marker.
- Added/retained regression tests that reject marker events without identified messages. **131/131 automated tests pass** locally with Node.js 22.
- No changes to configured recent-turn packing limits, the task guidance editor, ledger, checkpoints, dashboard, or tool-output optimization behavior. The five built-in default guidance items are numbered consecutively `1–5` in the open-source package (same wording as before).

## Why this matters / 修复背景

In v0.3.5, replacement markers were sometimes stored without an identifiable message id. DSH V4 session replay requires identified messages and could reject the entire stored session with `lacks an identified message`. The issue is in the plugin-emitted event rather than a truncated Zstandard file.

**v0.3.6 prevents future malformed packing markers. It does NOT automatically repair sessions already affected by v0.3.5.** See [Session identity incident and recovery guidance](docs/session-identity-fix.md).

## Confirmed acceptance / 验证

- DSH Desktop host reported as `2.0.21-next`; plugin boots as `0.3.6`, 7 routes mounted, no warnings during the reported test.
- 14/14 newly generated packing markers included valid UUIDs; 0 newly anonymous `user/message` markers in the tested session.
- Tested through turn 12 with 2-turn packing active, then restarted; native DSH V4 session reader validated the 1,067-event stored session and the UI reloaded it successfully.
- User-configured task guidance still appeared in the subsequent system prompt; ledger/checkpoint activity remained visible.

These are **user-provided field acceptance observations from one host environment**, not independent cross-version certification or cost-savings benchmarks. The original report includes sensitive paths and session metadata and is deliberately **not** included in this repository.

## Installation / 安装

1. Back up your plugin source, `<DSH_HOME>/storages/dsh-optimizer`, and relevant session directories.
2. Disable context packing before upgrading from 0.3.5.
3. Install this v0.3.6 bundle through DSH's plugin manager or from the checked-out repository; check plugin ID/version and restart if needed.
4. Verify regular conversations first; only then enable packing on a new test session and confirm it survives restart.
5. If older sessions already fail validation, use the separate, backup-first recovery process; updating the plugin alone will not restore them.

## Compatibility, limitations and security

- Field-tested host: DSH Desktop `2.0.21-next` only; other versions unverified.
- Turn-based packing is **off by default**. It does not limit system/tool schema tokens or guarantee cost reductions.
- Local dashboard/API are not hardened for Internet exposure.
- Open-source license is MIT, subject to maintainer confirmation of rights to all included code.

Links: [README](README.md) · [Install](docs/install.md) · [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md).
