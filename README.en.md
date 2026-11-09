# DSH Optimizer (智能优化管家)

[简体中文](README.md) · [Install](docs/install.md) · [v0.3.6 release notes](RELEASE_NOTES_v0.3.6.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

**Unofficial, community-developed plugin for DeepSeek Harness (DSH)**. Provides local usage and cost *estimates*, budgeting, checkpoints, anomaly monitoring, optional safe history packing by recent turns, and editable task guidance.

**Current source version: 0.3.6.** The only reported field-tested host build is DSH Desktop `2.0.21-next`; support for other versions has not been established. Node.js ≥20 is required to run development tests. MIT license, subject to verification of source ownership and redistribution rights before public publication.

> **Critical fix:** v0.3.5 emitted replacement `user/message` events without `data.id`, which can make stored DSH V4 sessions fail validation on reload. v0.3.6 generates a fresh UUID for every new replacement marker. Upgrading the plugin does **not** repair pre-existing malformed sessions; see [incident notes](docs/session-identity-fix.md).

## Features

- Local ledger, estimated token usage and prompt-cache savings, cost budgets, basic anomaly signals and checkpoint records.
- **Context packing by turns**: optional, **off by default**; retains 1–20 most recent completed conversational turns (default 3), trimming only safe older model-visible messages using DSH session-surface replacements. Original append-only session data remains intact. There is no hard total-token budget.
- **Editable task guidance**: saved locally and supplied to subsequent prompts through DSH `systemPrompt.section`. Not an authorization policy or file-access sandbox.
- Tool-output shaping in enforce mode; default audit mode measures without altering tool results.
- Local dashboard inside DSH settings.

The former history/workspace permission guard was removed in v0.3.5 and is **not** part of v0.3.6.

## Install

Back up your installed plugin, configuration and session data. Clone or extract this repository, then use the DSH plugin manager to install the repository root (the directory containing `package.json`), or the DSH CLI:

```bash
# From this repository's root; change the profile as needed
dsh plugin --profile desktop add .
```

Review and approve the source, restart the host if required, and verify the settings page displays **v0.3.6**. Do not manually alter the DSH profile lockfile or `node_modules`. See [installation](docs/install.md) and [upgrade/recovery](docs/upgrade.md).

## Tests

```bash
npm test
npm run check
npm run release:audit
npm pack --dry-run
```

**131 automated tests passed locally on Node 22**. A user-supplied DSH field report documents valid UUIDs in 14 newly emitted replacement markers, normal reload after 12 conversational turns, and a successful native V4 reader check. Those observations are not a general guarantee across host versions. See [sanitized field evidence](docs/field-validation.md).

## Limits and privacy

Token and price metrics are estimates, not invoices. Protected instructions and host-provided tools may remain in prompts. Prompt-cache efficiency may change, so cost savings are not guaranteed. Plugin state at `<DSH_HOME>/storages/dsh-optimizer` may contain sensitive tool output; do not publish it or real session logs. The local HTTP interface is **not a public authentication boundary**; do not expose the DSH web port publicly. The public source normalizes five default task-guidance items to numbering `1–5`, matching the field-tested manual numbering adjustment; users' personal customizations are stored separately and are never shipped.

See [security policy](SECURITY.md), [privacy](PRIVACY.md), [contributions](CONTRIBUTING.md), and [release checklist](docs/release-checklist.md).
