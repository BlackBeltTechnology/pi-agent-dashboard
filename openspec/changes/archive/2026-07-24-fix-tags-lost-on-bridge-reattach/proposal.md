## Why

User-owned session tags silently vanish after a PC reboot. Investigation (explore session `019f8a05`) confirmed tag **persistence** is fully wired end-to-end — the write path (`sessionToMeta` enumerates `tags`) and the cold-start read path (`session-scanner` restores `meta.tags`) are both correct, and tags are physically present on disk (15 sessions carried non-empty `tags` arrays at investigation time). The failure is not persistence; it is **tag survival across a bridge reattach**.

`MemorySessionManager.register()` (`packages/server/src/session/memory-session-manager.ts`, ~L90) rebuilds the `DashboardSession` from scratch on every register/re-register and carries over only a hardcoded whitelist of fields from the `existing` (restored) session:

```
...(existing ? { tokensIn, tokensOut, cacheRead, cacheWrite, cost,
                 attachedProposal,        // "user-set via dashboard UI, not polled"
                 contextTokens, contextWindow } : { ... })
```

`tags` is **not** in that list. `attachedProposal` — a user-set, dashboard-only, not-polled field of the *identical category* — was explicitly added; `tags` was missed by the `add-session-tags` change. Only the persist path (`sessionToMeta`) and the cold-scan path (`session-scanner`) received the field treatment; the reattach-register carry-over did not.

The reboot sequence that loses tags:

1. Server running, tags on disk. ✓
2. PC reboot — server + all bridges killed.
3. Server restarts → `scanAllSessions()` → `sessionManager.restore()` rehydrates `session.tags` from `.meta.json`. ✓ (in memory)
4. The resuming pi session's bridge reattaches → `session_register { registerReason: "reattach" }` → `register()` builds a NEW session object from the whitelist → **`tags` dropped** → `sessions.set(id, newSession)` overwrites the restored one.
5. `register()` fires `onChange` → `save(sessionToMeta(session))` writes `.meta.json` with `tags: undefined` → **tags wiped from disk too, permanently.**

Tags survive a *plain* server restart (no bridge reattach), which is why the existing round-trip test passes and the bug hid. They are lost the moment a session's bridge reattaches — exactly what a PC reboot with resuming sessions triggers.

Existing tests (`packages/server/src/__tests__/session-tags-persistence.test.ts`) cover the unrelated-save-no-wipe hazard and the cold-scan round-trip, but **neither exercises `restore(withTags) → register(reattach)`**. That is the uncovered scenario and the exact hole.

## What Changes

- `register()` reattach carry-over SHALL preserve `tags` from the `existing` restored session, alongside `attachedProposal`, so a bridge reattach never clobbers user-owned tags in memory or (via the trailing `onChange` save) on disk.
- Add a red test proving the failure first: `restore()` a tagged session, then `register()` with `registerReason: "reattach"`, and assert `tags` survive in memory AND on disk after the `onChange` save.
- Add a spec requirement closing the spec-level gap: tags SHALL survive a bridge reattach, not only a debounced save and a cold-start scan.

Out of scope (flagged for a separate decision, see design.md): `goalId` and other user/route-set `DashboardSession` fields absent from the same whitelist may have the identical latent bug. This change fixes `tags` and documents the audit; it does not broaden the whitelist blindly.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-tags`: the persistence contract SHALL additionally guarantee that a bridge reattach (`register` with `registerReason: "reattach"`) preserves the restored session's `tags` — the carry-over path, not only the persist-save and cold-scan-restore paths, is now in-spec.

## Discipline Skills

- `systematic-debugging` — root cause was found by evidence (on-disk tags present, path-by-path trace, register whitelist diff), not guesswork; the fix is gated on a red repro test.
- `review-code` — the fix is a one-line carry-over addition in a hot, shared code path (`register`); review that the added field cannot leak stale tags on FIRST register (the `existing` branch only runs on re-register, so a first register with no prior record is unaffected).

## Impact

- `packages/server/src/session/memory-session-manager.ts` (~L90) — add `tags: existing.tags` to the `existing ?` carry-over block. One line.
- `packages/server/src/__tests__/session-tags-persistence.test.ts` — add the reattach-survival test (red first, then green).
- `openspec/specs/session-tags/spec.md` (via delta) — new requirement for reattach survival.
- No wire-protocol change, no client change, no migration. Bridges still never send tags.
