# Design: unify-pi-core-into-package-queue

## Context

The dashboard tracks three kinds of long-running package operations:

| Kind | Server endpoint | Server class | Client state owner today | Survives unmount? |
|---|---|---|---|---|
| Extension install/remove/update | `POST /api/packages/{install,remove,update}` | `PackageManagerWrapper.run` | `packageQueue` (module singleton) | ✓ |
| Move | `POST /api/packages/move` | `PackageManagerWrapper.move` | `moveTracker` (module singleton) | ✓ |
| Pi-core update | `POST /api/pi-core/update` | `PiCoreUpdater.update` | **`UnifiedPackagesSection` `useState`** | ✗ |

All three share the same server-side busy lock: `PackageManagerWrapper.busy` is checked by `run` (extension), `move`, and `runExclusive` (pi-core). The lock is global and source-agnostic. Two ops cannot run concurrently regardless of kind.

The asymmetry is purely on the client. Pi-core was added before the queue existed and the state ended up in component-local `useState`. The screenshot bug — *"button reverts to enabled with red 409 error after navigating away and back"* — is the direct consequence: unmount discards `useState`, the queue/server stays busy, and the next click 409s.

A narrower fix (a parallel `pi-core-update-tracker.ts` mirroring `move-tracker.ts`) would address the screenshot bug without addressing the cross-domain 409 class (extension install during pi-core update → 409 → confusing red error on the wrong-looking row, and vice versa). This change addresses both by routing pi-core through `packageQueue`.

## Goals / Non-goals

### Goals

1. The screenshot reproduction disappears.
2. Pi-core update state survives `UnifiedPackagesSection` unmount/remount.
3. Cross-domain 409s are eliminated: an extension install enqueued while pi-core is updating is automatically queued, not POSTed-then-409'd.
4. There is exactly **one** module-level state machine for "single-flight package operations" on the client.
5. The change is reversible — pure client refactor with no protocol or server changes.

### Non-goals

- Bringing `moveTracker` into the queue. Moves are `moveId`-keyed, multi-phase, and have partial-success semantics. They don't fit the source-keyed model and there's no bug-fix justification for the refactor.
- Server-side reload debouncing. With "Update All" splitting into N enqueues, each pi-core update triggers its own session reload. Documented as a trade-off; if it becomes a UX issue, a follow-up change can add a debounce window inside `PackageManagerWrapper`.
- Resuming "is updating?" state after a hard page reload. Same rationale as the previous design draft — the queue is in-memory and rehydration would require a new server endpoint we're not adding.
- Unifying the WebSocket dispatch channels (`pi-core-event` and `pi-package-event`). The two event shapes are different; the channel boundary acts as a useful pre-filter at the message-handler routing layer.

## Decisions

### D1. Add a `kind: "extension" | "pi-core"` discriminator to the queue's op record

**Decision**: Extend `RunningOp` and `EnqueueRequest` with `kind`. Default value `"extension"` for every existing call site. `postOperation` switches on `kind` to choose the endpoint and completion strategy.

**Why a `kind` field instead of source-prefix-only**: source strings already carry too much meaning (package names, URLs, file paths). Reusing the same string slot to encode the operation kind via a `pi-core:` prefix is fragile — a future user could legitimately install an npm package literally named `pi-core` and the prefix collides. Explicit `kind` keeps dispatch deterministic. The `pi-core:` source prefix is kept as a self-documenting convention but is not the dispatch key.

```ts
interface RunningOp {
  operationId: string | null;
  source: string;
  kind: "extension" | "pi-core";   // NEW
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
  message: string;
  retries: number;
}
```

### D2. Pi-core completion is signalled by the POST response, not by a WebSocket event

**Decision**: For `kind: "pi-core"`, `postOperation` calls `completeRunning(success, message)` directly when the `fetch` resolves. The `pi_core_update_complete` WebSocket event is a no-op for the queue.

**Why this is correct**: the pi-core endpoint is *synchronous* from the client's perspective — `await piCoreUpdater.update(...)` only resolves when every npm update finishes, and the HTTP response carries the full results. There is no async ack pattern. Waiting for a WS event would be redundant and would re-introduce a race (POST resolved → WS hasn't arrived yet → queue thinks op is done when it actually is).

The extension flow is genuinely async (`run()` returns `operationId` immediately, executes in the background, completion arrives via WS). The two flows have different completion semantics and the queue must handle them differently. The discriminator is `kind`.

```
   Extension flow                 Pi-core flow
   ─────────────────────           ────────────────────────────────
   POST → 202 + operationId        POST → blocks 5–30 s on server
   running.message updates         running.message updates
     via package_progress             via pi_core_update_progress
   final state:                    final state:
     package_operation_complete       POST resolves with results
                                      (WS pi_core_update_complete also
                                       arrives but is ignored by the queue)
```

### D3. Pi-core "Update All" splits client-side into N single-name enqueues

**Decision**: When the user clicks "Update All" in the Core sub-group, the client iterates over `updatableCore` and calls `operations.coreUpdate(name)` for each. Each enqueue produces a single-name POST to `/api/pi-core/update` with `{packages: [name]}`. The queue serializes them via FIFO.

**Why not a single batch enqueue**: a batch source key (`pi-core-batch:pi+pi-dashboard+pi-model-proxy`) would force every Core row's render path to do a substring/contains match against `running.source` to decide its own busy state. That's a meaningful discriminator surface in the hot path — every render of every Core row becomes a string-search.

Splitting into N single ops keeps the source-key contract simple (`statusFor(s)` is still strict equality) and gives the user nicer feedback (per-package progress in the queue rather than an opaque "updating 3 packages…").

**Trade-off**: N session reloads instead of 1. Acceptable for typical N = 2-3. Documented as a trade-off; can be addressed later by a server-side reload debouncer that's orthogonal to this change.

**Why not preserve the batch endpoint shape and keep the client-side batch model**: that's effectively the same as the dropped "batch source key" option — same render-path issue.

### D4. The queue subscribes to both `pi-core-event` and `pi-package-event`

**Decision**: The `PackageQueue` constructor attaches **two** `addEventListener` calls: one to `pi-package-event` (existing) and one to `pi-core-event` (new). The handlers are separate methods (`onWindowEvent` for extension events, `onPiCoreEvent` for pi-core events) to keep the type-narrowing readable.

**Why not a single channel**: the two event payloads have meaningfully different shapes (`{source, action, type, message}` vs `{name, phase, message?}`). Routing both through one channel would require unconditional shape detection in every consumer, including future ones. Better to keep the channel as a pre-filter and accept two `addEventListener` calls.

**Why not a third "package-operation-event" channel that merges both**: that's the same kind of shape-erasure but with extra moving parts. The current two-channel routing in `useMessageHandler.ts` is fine; we just teach the queue to listen to both.

### D5. The hook surface gets a typed helper, not a polymorphic `enqueue`

**Decision**: `usePackageOperations` adds `coreUpdate(name: string): void` that constructs the right `EnqueueRequest`. Existing methods (`install`, `remove`, `update`, `move`) are preserved unchanged.

**Why not expose `enqueue` directly with a `kind` parameter**: the type-safety win from a dedicated helper is small but the discoverability win is substantial. `coreUpdate` clearly signals that pi-core is a different kind of operation. Future maintainers can grep for the helper and understand the dispatch surface; a polymorphic `enqueue({source, kind, action, ...})` blends pi-core into a sea of every other call.

The same pattern is already used by `move`, which has its own typed helper (`move(entry, args)`) instead of being shoehorned through the queue.

### D6. Component-level error attribution stays the same shape

**Decision**: The Core sub-group rows continue to show `error` text directly under the row when `statusFor("pi-core:" + name) === "error"`. The error message is read from `messageFor(...)`, which the queue populates the same way it populates extension error messages.

**Why preserve the per-row error display**: it's the existing UX pattern, established for extension rows. Migrating pi-core onto the same hook automatically gives pi-core the same error rendering. No new design surface.

## Risks / Trade-offs

### R1. N session reloads on "Update All"

**Mitigation**: documented above (D3 trade-off). For typical N = 2-3, total reload overhead is ~3-6 s on top of npm-update time. Not catastrophic; not invisible.

**Future**: a server-side reload debouncer (`PackageManagerWrapper.scheduleReload(deferMs)` that coalesces requests within a window) would address this for all package operation kinds, not just pi-core. Out of scope for this change.

### R2. `statusFor("pi-core:" + name)` collides with a hypothetical extension named `pi-core`

**Mitigation**: vanishingly unlikely (`pi-core` is not a real npm package), and the `kind` field makes dispatch deterministic regardless of source-string collisions. The prefix is convention, not contract.

**Detection**: if it ever happens, the colliding extension would be visible in the queue's per-source state alongside any pi-core update of the matching name. Easy to spot in the UI and quick to fix by namespacing the prefix more aggressively (e.g. `__pi-core__:pi`).

### R3. Pi-core POST is slow; the queue's running op has a long lifespan

**Mitigation**: this is already true today — `doCoreUpdate` awaits the same fetch. The queue is a singleton that retains the in-flight Promise via the `postPiCoreUpdate` closure. Component unmount during the wait is harmless because the closure outlives the component.

### R4. The `pi_core_update_complete` WS event is now ignored by the queue but still consumed by `usePiCoreVersions`

**Mitigation**: this is by design. `usePiCoreVersions` listens to refetch the version list when an update completes; the queue listens to update its own state. Both listeners on the same `pi-core-event` channel see the same events. There's no contention.

### R5. The 409-retry-once policy might fire in pi-core scenarios where it's surprising

**Mitigation**: same retry semantics as extension ops. If a pi-core POST returns 409 (because something else holds the busy lock — e.g. an extension install just started), the queue waits 500 ms and retries. If the second POST also 409s, the user sees the existing error UI. Same code path; same UX.

This is actually less surprising than today: today the pi-core component never retries, so a transient 409 always surfaces as an error. After this change, transient 409s may auto-recover.

## Migration plan

1. **Extend `packageQueue` with `kind` + `pi-core` dispatch**. All existing tests pass with `kind` defaulted to `"extension"`. New unit tests cover the pi-core dispatch arm.
2. **Add `coreUpdate` to `usePackageOperations`**. New hook test covers the path.
3. **Refactor `UnifiedPackagesSection`**. Snapshot the rendered output before/after to confirm no visual regression. Add a component-level integration test that simulates "click Update → unmount → remount → row still busy".
4. **Manual verification of the screenshot reproduction**.

Total implementation surface: ~150 LoC added to `packageQueue` + hook, ~80 LoC removed from `UnifiedPackagesSection`. Net: smaller component, larger queue, simpler overall architecture.

No protocol changes. No settings file migrations. Reversible by `git revert`.

## Open questions

- **Should `coreUpdate` accept a `scope` parameter?** Pi-core packages always live in a single scope (either npm-global or `~/.pi-dashboard/`), determined server-side from `pkg.installSource`. The client never picks a scope for pi-core updates. Decision: **no** — `coreUpdate(name)` takes only the name; scope is implicit (`"global"`).
- **Should the existing `usePackageOperations(scope, cwd, onComplete)` signature be extended for pi-core?** No. Pi-core has no per-cwd notion. The existing hook signature works as-is; we just add a method.
- **Should `isAnyRunning()` be exposed on the queue's public API as part of this change?** Yes — once pi-core is in the queue, `isAnyRunning()` correctly says yes during pi-core updates, which is needed by any future cross-domain UI lock. Adding it is one line; not adding it leaves the cross-domain lock as a follow-up. Decision: **add it**, with no consumer changes in this proposal. The follow-up that disables every package button while any op is running can land separately, gated by this primitive.
