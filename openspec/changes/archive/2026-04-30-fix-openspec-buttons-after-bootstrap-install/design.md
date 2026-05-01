## Context

Two related bugs surface together when a user starts the dashboard for the first time on a fresh machine (no `pi`, no `openspec` on PATH or in `~/.pi-dashboard/`):

1. **`packages/server/src/cli.ts:265-267`** — after `bootstrapInstall` succeeds, the post-install rescan only invalidates the `pi` Resolution:
   ```ts
   const maybeRescan = (registry as unknown as Rescannable).rescan;
   if (typeof maybeRescan === "function") maybeRescan.call(registry, "pi");
   ```
   The `unified-bootstrap-install/tasks.md:40` task 4.3 specified "registry rescan" with no argument — this implementation narrowed it. As a result, the cached `Resolution { ok: false, path: null }` for `openspec` and `tsx` survives forever, and `platform/runner.ts::resolveExecutorArgv("openspec")` returns `null` on every subsequent call → `Result { ok: false, error: { kind: "not-found" } }` → poller treats every directory as `{ initialized: false, changes: [] }`.

2. **`packages/server/src/server.ts:472-475`** — the `bootstrapState.subscribe` hook's `installing → ready` transition only flushes the bootstrap queue. It does NOT re-poll OpenSpec data. Even if Bug 1 were fixed in isolation, the in-memory `DirCache` still holds the empty result and waits up to one full `pollIntervalSeconds` (default 30 s) for the next gated tick — and the gate compares mtimes, so it may stay quiet across multiple ticks. The `triggerUpgradePi` / `triggerRetry` paths in the same file have NEITHER rescan NOR refresh.

The OpenSpec session-card UI (`P/D/T/S` letters, attach combo, refresh button) reads `directoryService.getOpenSpecData(cwd)` via the `openspec_update` broadcast cache. Until that cache contains a non-empty `changes[]`, no buttons render.

## Goals / Non-Goals

**Goals:**
- Make OpenSpec session-card buttons appear within ~1 second of the bootstrap install completing, on every transition path (`runDegradedModeBootstrap`, `triggerUpgradePi`, `triggerRetry`).
- Restore the original `unified-bootstrap-install` task-4.3 contract: post-install rescan covers the **entire** registry.
- Centralize the post-install repair work in one site (`server.ts` subscribe callback) so all three callers benefit uniformly — DRY.
- Bound the new force-refresh load to what existing specs already accept for the user-click refresh path.

**Non-Goals:**
- Watching `bootstrapInstall` progress events or running rescan mid-install. Only the terminal `installing → ready` transition matters.
- Changing the polling cadence, semaphore size, or mtime-gate behavior. The `optimize-openspec-poll-burst` and `fix-openspec-mtime-gate-toctou` specs are preserved unchanged.
- Adding a rescan on the `installing → failed` transition (no install means nothing new to find).
- Adding a rescan on `ready → ready` no-op transitions (already handled by the `lastBootstrapStatus !== "ready"` guard).

## Decisions

### Decision 1: Centralize post-install repair work in `server.ts`'s existing subscribe hook

**Chosen:** add the rescan + force-refresh + broadcast block inside the existing `bootstrapState.subscribe` callback, gated on the same `lastBootstrapStatus !== "ready" && snapshot.status === "ready"` condition that already flushes `bootstrapQueue.flushAll()`.

**Why:**
- One site covers all three callers (`runDegradedModeBootstrap`, `triggerUpgradePi`, `triggerRetry`) — including the two callers that currently have NO rescan at all.
- The `lastBootstrapStatus` guard already exists; the `installing → ready` semantics are already proven correct (queue flush works the same way).
- Keeps the fix minimal: ~10 lines in one file plus a deletion in another.

**Alternatives considered:**
- **A) Fix only `cli.ts`'s `rescan("pi")` → `rescan()`.** Rejected: leaves `triggerUpgradePi` and `triggerRetry` broken, and still waits up to 30 s for the gated poll to recover.
- **B) Have `bootstrapInstall` itself call `registry.rescan()` on success.** Rejected: tighter coupling between the install module and the registry singleton; harder to test; doesn't solve the openspec-cache staleness without a second per-call site.
- **C) Add a separate `onBootstrapReady` lifecycle hook with its own subscribers list.** Rejected: ceremony for a single internal use case. The existing `subscribe` callback is the right seam.

### Decision 2: Use `refreshOpenSpec(cwd)` (force-refresh) for every known directory

**Chosen:** call `directoryService.refreshOpenSpec(cwd)` for each `directoryService.knownDirectories()` entry on the transition. Broadcast `openspec_update` for each non-empty result.

**Why:**
- `refreshOpenSpec` is the documented "user-class escape hatch" path per `fix-openspec-mtime-gate-toctou/design.md:67`: bypasses the mtime gate (the cache is poisoned with empty data and would otherwise stay quiet), still honors the shared semaphore (`optimize-openspec-poll-burst/design.md:195`).
- A first-run install completing is a **one-shot, infrequent event** — load profile matches a user clicking the refresh button (which the spec explicitly accepts), not periodic burst.
- `refreshOpenSpec` already exists; no new API surface needed.

**Alternatives considered:**
- **A) Call `pollDirectoryGated(cwd)` (gated path).** Rejected: the gate may decline to re-poll if the `cwd`'s `openspec/changes/` mtime hasn't advanced since boot. The user gets nothing until something is touched.
- **B) Synthesize a "force gated cache reset" by clearing `caches.set(cwd, emptyDirCache())` then calling the gated path.** Rejected: backdoor mutation of `DirectoryService` internals; replicates `refreshOpenSpec`'s job; brittle.

### Decision 3: Rescan the entire registry, not just `["pi", "openspec", "tsx"]`

**Chosen:** call `registry.rescan()` with no argument.

**Why:**
- Restores the literal contract from `unified-bootstrap-install/tasks.md:40` ("registry rescan" with no name).
- The install may have unblocked any tool that resolves through the same managed-install strategies (e.g. future additions to the bootstrap package list won't need this site updated).
- `rescan()` only invalidates the in-memory caches (`Map.clear()` × 3); it does NOT re-read `tool-overrides.json` from disk eagerly — that happens lazily on next `resolve()`. The cost is constant-time and tiny.
- Same operation already runs on every `POST /api/tools/rescan` call (`tool-routes.ts:93`), so the side-effect surface is already battle-tested.

**Alternatives considered:**
- **A) Rescan only the package set the install touched.** Rejected: tighter coupling, more bookkeeping, no measurable benefit. A full rescan is constant-time.
- **B) Skip rescan and add an mtime-watcher on the managed install dir.** Rejected: cross-platform `fs.watch` quirks (already explicitly rejected for openspec polling — see `optimize-openspec-poll-burst/design.md:37`); rescan-on-transition is the simpler and existing pattern.

### Decision 4: Drop the now-redundant `rescan("pi")` block in `cli.ts`

**Chosen:** delete lines `cli.ts:265-267` and the surrounding `Rescannable` type alias. Replace with a comment citing the centralized hook.

**Why:**
- The new `server.ts` subscribe-hook block runs strictly before the next time anything reads from the registry (the queue flush waits for the same transition). Deleting the local rescan removes dead code and prevents future drift between the two sites.
- `cli.ts:268-285` (the `findBundledExtension` + `registerBridgeExtension` block) does NOT depend on the rescan having run — it works against `findBundledExtension` paths derived from `process.cwd()`, not the registry.

### Decision 5: No new protocol messages, no client changes

**Chosen:** reuse the existing `openspec_update` broadcast.

**Why:**
- The client already handles `openspec_update` and re-renders session cards on receipt. From the client's perspective, this fix looks identical to "the periodic poller delivered fresh data."
- Touches one server file plus tests. Zero churn outside the server module.

## Risks / Trade-offs

- **[Risk]** Force-refresh on transition spawns up to `(known-cwds × changes-per-cwd)` concurrent CLI calls capped by `maxConcurrentSpawns` (default 4). On a worst-case repo (5 cwds × 20 changes = 100 status calls, 4 at a time × 0.5 s each ≈ 12 s of background work) this could pin one CPU core for ~12 s.
  → **Mitigation:** identical to the load profile the `optimize-openspec-poll-burst` spec already accepts for the user-click refresh button (`design.md:195`). One-shot per first-run install — not periodic. Semaphore-bounded.

- **[Risk]** `triggerUpgradePi` already broadcasts `/reload` to connected pi sessions on success. Adding rescan + force-refresh on the same transition could interleave with the `/reload` chatter.
  → **Mitigation:** they touch different surfaces (registry vs. pi-extension protocol) and the broadcasts are independent. No shared state. Worst case: a brief CPU spike during the `/reload` storm.

- **[Risk]** The bootstrap-state `subscribe` callback runs synchronously before broadcasting. A long `refreshOpenSpec` walk could delay other subscribers.
  → **Mitigation:** wrap the rescan + per-cwd refresh loop in a fire-and-forget `void Promise.all(...)` (matching `session-bootstrap.ts:86-91`'s existing pattern for the boot-time initial poll). The `subscribe` callback returns immediately; refreshes happen in the background.

- **[Risk]** A user racing through the wizard clicks "Retry" rapidly before the previous install finishes. The `installing → ready → installing → ready` flap could fire the post-install hook twice in quick succession.
  → **Mitigation:** identical concern already exists for the existing `bootstrapQueue.flushAll()` call on the same transition. Two consecutive `refreshOpenSpec` calls are idempotent (the second one re-reads the same disk state); the only cost is a doubled CLI burst, still bounded by the semaphore. Not worth additional throttling.

- **[Trade-off]** No rescan on `installing → failed`. A user who manually installs `openspec` after a failed bootstrap and then clicks Retry will get the rescan only when Retry's own `installing → ready` transition fires. This matches today's behavior and the spec's contract.

## Migration Plan

No migration. The change is server-side only and backward-compatible:
- Existing clients see the same `openspec_update` broadcast they already handle.
- Existing `tool-overrides.json` files are untouched.
- Existing `bootstrapState` REST contract is unchanged.
- Existing tests for `cli.ts`'s `rescan("pi")` get updated to assert full `rescan()` instead.

**Rollback:** revert the commit. No state migration needed; the `DirCache` and `ToolRegistry` caches rebuild on next access regardless.

## Open Questions

- Should the post-install hook also trigger a `refreshPiResources(cwd)` for each known directory? Today the pi-resources scanner runs at 5× the openspec interval (default 150 s), so the user could see "no installed pi-skills/extensions/prompts" for ~150 s after first-run install. **Inclination:** yes — same load profile, same pattern, costs nothing extra. Will include in tasks.
- Should we emit a `bootstrap_status_update` log line citing this change name when the post-install hook fires, mirroring the existing `[bootstrap] ready` log in `cli.ts`? **Inclination:** yes for diagnostic clarity. Single `console.log("[bootstrap] post-install rescan + force-refresh complete")` line, gated on `DEBUG=pi-dashboard|openspec-poll` to avoid log noise on every install.
