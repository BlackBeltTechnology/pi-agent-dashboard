# Investigation notes (Section 1)

`systematic-debugging` discipline applied. These gate the implementation sections; findings are
evidence-backed from the code as it stands on this branch.

## 1.1 — Suspected register-ordering race (defect 3)

**Disposition: not blocking this change; token path deliberately left untouched.**

The proposal scopes defect 3 behind a repro *before touching the token path*. Sections 2–6 of this
change do **not** edit the token path:

- `linkByToken` (Tier 1, `headless-pid-registry.ts`) is unchanged — it remains the sole
  identity-bearing capture site for `piPid`.
- `event-wiring.ts`'s three-tier dispatch (`linkByToken → linkByPid → linkSession`) is unchanged.
- `session-action-handler.ts` token minting is untouched.

Ordering as read from code: a keeper-backed spawn registers its entry via
`spawnHeadlessViaKeeper` → `registry.register(keeperPid, …, spawnToken)`; pi boots *inside* the
keeper and its bridge later emits `session_register {spawnToken, pid: piPid}`, resolved by
`event-wiring.ts`. The suspected race is `session_register` arriving before `register()` has
created the entry, so all three tiers miss and a later token-less re-register links via cwd-FIFO
(which never captured `piPid`). This change makes that survivable by **recovering** `piPid` from
the keeper sidecar (§4/§5) rather than by altering the token path, so a live repro is not a
precondition for the fix as scoped. The token-path edit that *would* require the repro is
explicitly out of scope. Recorded as hypothesis; no token-path change made.

## 1.2 — Non-reconnecting bridge (keeper `abe06e02`, pi 76302)

**Disposition: not reproducible.** The specific processes were observed live on 2026-08-15
(keeper 75884/`abe06e02`, pi 76302); those processes no longer exist and the transient TCP/bridge
state cannot be reconstructed from the tree. Per the task's own escape (“root cause stated with
evidence, or explicitly recorded as not reproducible”), this is recorded as not reproducible. No
requirement is written against it (the proposal already declines to specify a fix for an
unexplained symptom).

## 1.3 — Two code realities (gates §5)

Both **confirmed by reading the code on this branch**:

1. **`cleanupKeeperOrphans` skips reclaimed entries via its `keeperPid === undefined` guard.**
   In `headless-pid-registry.ts`, `cleanupKeeperOrphans` only mutates an entry under
   `existing && existing.keeperPid === undefined`. `cleanupOrphans` reclaim restores `keeperPid`
   from the persisted pid file (`if (entry.keeperPid !== undefined) reclaimed.keeperPid = …`), so
   for every reclaimed keeper entry that guard is **false** and the reconciliation body is skipped.
   §5 must widen this for the pi-PID branch (task 5.6). Confirmed.

2. **`KeeperEntry.sessionId` is the keeper transport id, not pi's session UUID.** In
   `keeper-manager.ts`, `discoverExistingKeepers` derives `sessionId` from the sidecar filename
   (`<sessionId>.rpc.sock.pid` / `pi-rpc-<sessionId>.pid`), i.e. the keeper's spawn argv
   (`spawnKeeperFor(sessionId, …)` → `args: [keeperPath, sessionId]`), which is a `randomUUID`
   minted at spawn — distinct from pi's session UUID that keys registry entries. Reconciliation
   therefore associates results with entries by **keeper PID** (`entries.get(k.keeperPid)`), never
   by that transport id. Confirmed.
