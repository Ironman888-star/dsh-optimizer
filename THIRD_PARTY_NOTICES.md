# Third-party notices

## dsh-delete-turn v0.2.7

- Original author: **DDDMUC**
- Original project: https://github.com/DDDMUC/dsh-delete-turn
- License: **MIT**; Copyright (c) 2026 DDDMUC.
- Source files: `vendor/dsh-delete-turn/src/` (unaltered copies of upstream v0.2.7 supplied by the user).
- The optimizer's browser `client.js` includes the original upstream client factory **embedded** inside the single `dsh-optimizer` browser module, with only the separate bundle's configuration slot omitted because its preference card is shown on the optimizer settings page instead.
- The upstream host is registered through the optimizer's host. The deletion API continues to use `/dsh-delete-turn/*` and original `plugin:dsh-delete-turn` source markers for compatible replay. It is not a separately installed plugin.

The full upstream license is in `vendor/dsh-delete-turn/LICENSE`. This project also retains its own MIT license.

**Do not install the standalone `dsh-delete-turn` in the same DSH profile as this integrated version:** their HTTP routes, slot IDs and marker names overlap.
