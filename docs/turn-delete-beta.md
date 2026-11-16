# Deletion integration (v0.3.7)

This release REPLACES the earlier self-written turn-delete module (`lib/turn-delete.js`, optimizer `/turns/*` routes and related controls). The integrated implementation is from DDDMUC/dsh-delete-turn v0.2.7, MIT-licensed, as included under `vendor/dsh-delete-turn`. See `THIRD_PARTY_NOTICES.md`.

Functions: delete single user message, assistant reply, tool step, whole turn, multi-select, or recall unsent queue item. Hide deleted transcript rows and omit deleted nodes from subsequent model history using surface-replace, keeping the append-only event log. History already compacted off surface is not individually deletable.

Routes: `/dsh-delete-turn/state`, `/dsh-delete-turn/delete`, `/dsh-delete-turn/queue-remove`. All three belong to the **one installed dsh-optimizer bundle**. Do not separately install dsh-delete-turn in this profile.

Critical safety: write carriers require `data.id` (UUID) and `role: user` and must pass the DSH V4 cold replay validator. Context packing and deletion both mutate session surface and must be exercised together on throwaway sessions before any production upgrade. The upstream host includes loopback and same-origin checks, but those do not authenticate the owner.

To test on DSH Desktop: backup, install into isolated profile, run 8+ turns, delete one whole turn and a step with a paired tool call, multi-select two messages, refresh, restart DSH, inspect original session with the **actual** DSH V4 reader, verify no `lacks an identified message`, and ensure original v0.3.6 accounting / task instructions remain intact.

Field validation on the owner's DSH Desktop is complete: UI rendering, whole-turn deletion, immediate/reload/restart hide persistence, joint operation with recent-N context packing (including 409 refusal for already-packed turns), native V4 cold replay with valid UUIDs, and regression of the original optimizer features all passed on 2026-11-15/16.
