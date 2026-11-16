# DSH Optimizer v0.3.7-beta.2 — upstream deletion integration

- Replaces (rather than keeps alongside) the experimental self-written turn deletion module introduced in beta.1.
- Integrates the MIT-licensed **DDDMUC/dsh-delete-turn v0.2.7** for per-message, reply, step, whole-turn, multi-select and queued-message removal.
- Keeps existing analytics, turn-based packing, editable instructions and persistence features from the previously field-validated v0.3.6.
- Single bundle `dsh-optimizer`, with the upstream deletion logic under `vendor/dsh-delete-turn` and UI merged into the optimizer's only browser bundle.
- No release change to the upstream v0.3.6 GitHub tag. This is a test build only.
- **Do not** also install standalone `dsh-delete-turn` in the same profile.
- Requires Node.js >=22. Testing in actual DSH Desktop, including cold session validation and packing/deletion concurrency, is mandatory before a stable release.
- Upstream `contract.test.js` requires proprietary DSH packages in the runtime; not runnable in this isolated environment.
