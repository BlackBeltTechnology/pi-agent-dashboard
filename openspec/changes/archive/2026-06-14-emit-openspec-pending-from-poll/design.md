# Design

## Context

`pollOne(cwd, force)` (`directory-service.ts:309`) already computes both cheap
signals at the top, **before** the slow CLI spawn:

```
const hasOpenspecDir = statMtimeOr(openspecRoot) !== undefined;   // <cwd>/openspec/
const rootMtime      = statMtimeOr(changesRoot);                  // <cwd>/openspec/changes/
if (rootMtime === undefined) { /* short-circuit: not pollable */ }
// ── Step 1: list (gated) ──  ← the slow `runOpenSpecList` await
```

But `pollOne` only **returns** `OpenSpecData`; it does not broadcast. Broadcast
happens one level up via `onChangeCallback`:
- periodic tick wrapper (`directory-service.ts:626-631`)
- `onWatcherFired` (`directory-service.ts:544-546`)
- `event-wiring.ts:732` for `onDirectoryAdded`

So the transitional `pending` emit needs a broadcast hook the poll path can
call **before** awaiting the CLI. The cache currently has no `initialized`
data on first poll of a freshly-appeared dir, which is exactly the condition
for emitting `pending`.

Emit condition (precise): `rootMtime !== undefined` (changes/ exists) **AND**
`cache.data?.initialized !== true` (no authoritative data yet). The
`changes/`-exists requirement also prevents an `openspec init`-but-no-proposals
dir from tripping the spinner forever — that case has `openspec/` but no
`changes/`, so `rootMtime` is undefined and no `pending` is emitted.

## Goals / Non-Goals

- Goal: every poll path that discovers a pollable-but-uncached openspec dir
  emits `pending: true` before the CLI, then the final `initialized` payload.
- Goal: zero spinner for non-openspec dirs; zero new timers.
- Non-Goal: changing cold-boot snapshot behavior, the mtime gate, the
  concurrency semaphore, or any client code (spinner already renders
  `pending: true`).

## Decision: where the pending emit lives

### P1 — pass the broadcast callback into `pollOne`, emit inline

`pollOne` gains access to `onChangeCallback` (already a module-scoped
variable). Right after the `rootMtime === undefined` short-circuit, if
`cache.data?.initialized !== true`, call
`onChangeCallback?.(cwd, { initialized:false, pending:true, changes:[], hasOpenspecDir })`
before the `runOpenSpecList` await.

- (+) Single touch point — covers periodic tick, watcher, and `onDirectoryAdded`
  automatically, since all route through `pollOne`.
- (+) Smallest diff.
- (−) `pollOne` gains a side effect (broadcast) on top of returning data; mixes
  concerns.
- (−) `onChangeCallback` is null until `startPolling` wires it; the
  `onDirectoryAdded` path runs `pollDirectoryGated` which may execute before/
  outside that wiring. Need to confirm the callback is set, or the emit silently
  no-ops (acceptable — cold-boot/registration still covers it).

### P2 — split detect-and-emit from list-and-emit

Extract a tiny `emitPendingIfDiscovered(cwd)` that does the cheap stat + emits
`pending` via `onChangeCallback`, called by each broadcast wrapper just before
it awaits `pollDirectoryGated(cwd)`. `pollOne` stays pure (returns data only).

- (+) `pollOne` stays a pure function — unchanged test surface.
- (+) Broadcast stays in the broadcast wrappers where `onChangeCallback` is
  guaranteed wired.
- (−) Three call sites to touch (tick wrapper, `onWatcherFired`,
  `event-wiring.ts onDirectoryAdded`) instead of one — easy to miss one.
- (−) Re-stats the dir (cheap, but duplicated work with `pollOne`'s own stat).

### Decision: P2 (locked)

**P2 — split detect-and-emit from list-and-emit.** Keeping `pollOne` pure preserves the existing parity/derive test suite
(`openspec-poller-*.test.ts`) untouched and puts the broadcast where the
callback is reliably wired. The "three call sites" cost is bounded — there are
exactly three broadcast wrappers, and a single shared helper de-dupes the
logic. P1's inline emit is tempting for diff size but couples data derivation
to transport and lands the emit on a path where `onChangeCallback` may be null.

Open for reviewer override: if a future refactor unifies the three broadcast
wrappers into one, P1 becomes strictly better and this should be revisited.

### Implementation refinement (locked): single choke point at `pollDirectoryGated`

All three broadcast wrappers — the periodic tick (`scheduleOpenSpecTick`),
`onWatcherFired`, and the `onDirectoryAdded` service method — already `await
pollDirectoryGated(cwd)`. The user-facing `refreshOpenSpec` does **not** (it
calls `pollOne(cwd, true)` directly), and the only other caller, the
post-bulk-archive refresh, is guarded by the `cache.data?.initialized === true`
check (a populated change set is always `initialized:true`, even after archiving
to zero changes). So a single `emitPendingIfDiscovered(cwd)` call at the top of
`pollDirectoryGated` realizes P2's shared-helper intent with **one** touch
point instead of three — eliminating the "easy to miss one" con the design
flagged — while keeping `pollOne` pure. This is the anticipated
"wrappers unified into one" case noted above, resolved toward a single helper
rather than P1's inline emit.

## Risks

- **Spinner stuck forever** if a `pending` emit is followed by no final
  broadcast (e.g. the CLI fails and the failure path doesn't broadcast). The
  failure branch in `pollOne` already returns `{ initialized:false }` and the
  wrapper broadcasts on JSON-diff — verify a `pending:true → initialized:false`
  (no changes) transition clears the spinner. `FolderOpenSpecSection` resolves
  `!initialized && !pending` to "render nothing", so the spinner clears. Add a
  test for this terminal state.
- **Duplicate `pending` broadcasts** across rapid ticks. Harmless — client
  setState is idempotent for identical payloads; the JSON-diff guard in the
  wrappers suppresses repeats.
