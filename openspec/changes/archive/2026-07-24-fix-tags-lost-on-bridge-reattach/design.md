# Design — fix-tags-lost-on-bridge-reattach

## Root cause (confirmed)

Three code paths must each independently name a dashboard-owned field, because none of them merges — they all rebuild or full-overwrite:

| Path | File | Handles `tags`? |
|---|---|---|
| Persist save (full `.meta.json` overwrite) | `session/session-to-meta.ts` `sessionToMeta` | ✓ enumerated |
| Cold-start restore (scan `.meta.json` → session) | `session/session-scanner.ts` | ✓ `tags: meta.tags` |
| **Register / reattach carry-over** | `session/memory-session-manager.ts` `register()` | ✗ **missing** |

The `add-session-tags` change patched the first two and missed the third. `register()` does not merge into `existing`; it constructs a fresh object and copies only a whitelist:

```
...(existing ? {
  tokensIn, tokensOut, cacheRead, cacheWrite, cost,
  attachedProposal,          // user-set via dashboard UI, not polled
  contextTokens, contextWindow,
} : { tokensIn: 0, tokensOut: 0, cost: 0 })
```

`attachedProposal` is the precedent: a user-set, dashboard-only, non-polled field deliberately carried across reattach. `tags` is the same category and belongs beside it.

## Why it only bites on reboot-with-resume

```
plain server restart          PC reboot + session resume
────────────────────          ───────────────────────────
scan → restore(tags) ✓         scan → restore(tags) ✓
(no bridge reattach)           bridge reattaches
tags stay ✓                    register(reattach) rebuilds w/o tags ✗
                               onChange → save(sessionToMeta) → disk wiped ✗
```

The existing round-trip test only exercises the left column, so it stays green while the bug ships.

## Fix

Add one line to the `existing ?` branch of `register()`:

```
attachedProposal: existing.attachedProposal,
tags: existing.tags,          // preserve user-owned tags across reattach
contextTokens: existing.contextTokens,
```

`existing` is only truthy on re-register, so a genuine first register (spawn / new session, no prior record) is untouched — no risk of leaking stale tags onto a fresh session.

## Decision: scope to `tags`, audit the rest separately

The same whitelist omits other user/route-set fields — notably `goalId` (set via dashboard UI / goal routes, not polled), and arguably `displayPrefsOverride`, `processDrawerCollapsed`, `unread`, `nameSource`, `lifecyclePolicy`, `gitWorktree*`. Each *could* have the identical reattach-wipe bug.

Chosen: fix `tags` (the reported, confirmed failure) now with a red-test gate; do **not** blind-add the rest in this change. Rationale — some of those fields are intentionally reset on reattach (e.g. `pendingQueues` is explicitly cleared; `hidden` is special-cased). Broadening the whitelist without per-field reasoning risks resurrecting stale state. The audit is captured as a follow-up task, not folded in.

Open question for the follow-up: is the right long-term shape a documented "reattach-preserved dashboard-owned fields" list co-located with `sessionToMeta`'s enumeration, so the three paths cannot drift again? Deferred — out of scope here.

## Test strategy

Red first, in `session-tags-persistence.test.ts`, mirroring the existing harness (real `MetaPersistence`, `onChange` = full-overwrite save):

1. `register()` a session, `update({ sessionFile, status: "ended" })`, `update({ tags: ["feature"] })`, `flushAll()` — tags on disk.
2. Simulate reboot-resume: `register({ id, ..., registerReason: "reattach" })`.
3. Assert `mgr.get(id).tags` still `["feature"]` (in-memory survival).
4. `flushAll()`; assert `readSessionMeta(sessionFile).tags` still `["feature"]` (disk not wiped by the reattach `onChange` save).

Step 3/4 fail against current code (whitelist drops tags), pass after the one-line fix.
