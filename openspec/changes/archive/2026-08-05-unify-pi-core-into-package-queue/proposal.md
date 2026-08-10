## Why

Updating `pi (core agent)` (or any other package in the **CORE** sub-group of `Settings → Pi Ecosystem`) shows the correct in-progress spinner for the first few seconds, but if the user navigates away from the Settings panel and back while the update is still running on the server, the row's button reverts to a clickable "Update". Clicking it produces a red error directly under the now-idle-looking button:

> A package operation is already in progress

The user is presented with a button that looks ready to click, then punished for clicking it. The original update is still running on the server — the UI just lost track of it.

### Two converging structural problems

1. **Pi-core update state lives in component-local React `useState`.** `packages/client/src/components/UnifiedPackagesSection.tsx` keeps the `coreUpdating: Set<string>`, `coreProgress: Map<...>`, `coreErrors: Map<...>` state inside the component. Any sidebar navigation away from Settings unmounts the component and discards all three. On remount, `coreUpdating` is empty and the button renders enabled. The user clicks, the second POST 409s through `pmWrapper.runExclusive`, and the error appears under the row.

2. **Pi-core operations are unaware of the rest of the package operation system.** The dashboard already has a singleton `packageQueue` (`packages/client/src/lib/package-queue.ts`) that tracks extension install/remove/update operations and survives unmount. There's no architectural reason pi-core couldn't ride the same queue — both kinds of operation share the same server busy lock (`PackageManagerWrapper.busy`), both produce streaming progress events, both surface per-row spinners and errors. Pi-core was added before the queue existed and was never migrated.

The naive fix is to add a third singleton (`pi-core-update-tracker.ts`) modelled on `move-tracker.ts`. That fixes the screenshot bug but leaves a structural disparity: three independent state machines on the client tracking ops that share one busy lock on the server. The disparity has its own bug class — when pi-core is updating, every extension install/uninstall button across the UI is still enabled and will produce the same 409 the user just saw.

This change picks the architectural fix over the narrow one: **pi-core operations flow through `packageQueue` like everything else**.

## What Changes

### 1. `packageQueue` learns to handle pi-core operations

- Extend `RunningOp` and `EnqueueRequest` in `packages/client/src/lib/package-queue.ts` with a `kind: "extension" | "pi-core"` discriminator (default `"extension"` for backwards compat with every existing call site).
- Pi-core operations key as `pi-core:${packageName}` where `packageName` is the full npm name from `CORE_PACKAGE_NAMES` in `packages/server/src/pi-core-checker.ts` (e.g. `pi-core:@mariozechner/pi-coding-agent`, `pi-core:@blackbelt-technology/pi-agent-dashboard`, `pi-core:@blackbelt-technology/pi-model-proxy`). The prefix is canonical and self-documenting; the `kind` field is the actual dispatch key but the prefix lets human readers grep.
- `postOperation` dispatches by `kind`:
  - `"extension"` → existing flow: POST `/api/packages/{action}` → wait for `package_operation_complete` WS event.
  - `"pi-core"` → new flow: POST `/api/pi-core/update` with `{packages: [name]}` → completion is signalled by the POST response itself (the pi-core endpoint is synchronous from the client's perspective; it returns when the update has actually finished).
- The 409 retry-once policy applies uniformly to both flows.
- `onWindowEvent` adds two new arms for `pi-core-event`:
  - `pi_core_update_progress {name, phase, message?}` → if `running.source === "pi-core:" + name`, update `running.message`. Otherwise no-op.
  - `pi_core_update_complete` → no-op for queue tracking (the POST response handles completion). Other consumers (e.g. `usePiCoreVersions`) continue to listen for refetch purposes; they're unaffected.

### 2. `usePackageOperations` gains a typed pi-core helper

- Add `coreUpdate(name: string): void` that calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`. The `name` argument is the full scoped npm name (e.g. `@mariozechner/pi-coding-agent`), matching `PiCorePackage.name` returned by `GET /api/pi-core/versions`.
- The `scope: "global"` value is a non-meaningful placeholder for pi-core ops — `/api/pi-core/update` does not consume the `scope` field; the server-side install location is determined per-package from `PiCorePackage.installSource` (`"global"` for npm-global vs `"managed"` for `~/.pi-dashboard/`). We pick `"global"` to satisfy the `EnqueueRequest.scope` type contract without introducing a third enum value.
- All existing API on the hook is preserved.

### 3. `UnifiedPackagesSection` deletes its pi-core state

- Remove `useState` for `coreUpdating`, `coreProgress`, `coreErrors`.
- Remove the `pi-core-event` `useEffect` listener (the queue owns it).
- Remove the local `doCoreUpdate` `useCallback`.
- Wire Core sub-group `<PackageRow>` props through `usePackageOperations`. `pkg.name` here is the full scoped npm name (e.g. `@mariozechner/pi-coding-agent`):
  - `busy={operations.runningSource === "pi-core:" + pkg.name}`
  - `progress={operations.runningSource === "pi-core:" + pkg.name ? operations.operation.message : undefined}`
  - `error={operations.statusFor("pi-core:" + pkg.name) === "error" ? operations.messageFor("pi-core:" + pkg.name) : undefined}`
  - `onUpdate={() => operations.coreUpdate(pkg.name)}`
- "Update All" iterates over `updatableCore` and calls `operations.coreUpdate(name)` for each. The queue handles FIFO serialization automatically. The button stays **enabled** while operations run — the queue's (source, action) dedupe makes a repeat click idempotent — and is disabled only when there is nothing updatable.

### 4. The queue becomes visible; row buttons stay clickable

This mostly falls out of (1): the queue's single-flight contract now spans both kinds, so an extension install clicked during a core update enters the `queued` state automatically instead of 409ing.

What this change adds on top is the *visibility*, because a queued op the user cannot see is barely better than a 409:

- Row buttons stay **enabled** while another operation runs. A click enqueues.
- `PackageRow` gains a `queued` prop — a `queued` pill plus a "Queued" action label — so the click is visibly accounted for. A row whose own op is already pending disables its own button (the work is already registered, which is the opposite of losing the click).
- `enqueue` dedupes on the **(source, action)** pair rather than on `source` alone, so double-clicks and repeat "Update All" presses cannot stack duplicate work, while `remove` and `update` of the same source remain distinct.
- **Move and Reset-to-npm are the only controls disabled while busy** (`locked` ← `isAnyRunning`), with the reason in a tooltip. They ride `moveTracker`, not `packageQueue`: `moveId`-keyed identity plus partial-success semantics don't fit the source-keyed `statusFor(source)` contract, so they can't be queued yet — and being unqueued they take the busy lock directly with no retry.

The governing principle is **no enabled click is silently lost**. An earlier draft of D9 instead disabled every lock-taking control while any op ran; that was reversed, because an inertly disabled button and a silently-409ing button are the same defect — the UI not telling the truth about what it did with the click — and disabling additionally freezes the whole panel for the duration of a multi-minute core update.

### Scope guardrails

- **`moveTracker` stays separate.** Moves use a different identity scheme (`moveId`-keyed, partial-success semantics) and a different REST endpoint with composite phases. Bringing moves into the queue would be a larger change with no bug-fix justification.
- **No server-side changes.** The `/api/pi-core/update` endpoint accepts batch input today; we choose to call it with single-name batches from the client, but we don't break the batch shape for any other consumer. The endpoint and the `PiCoreUpdater` class are unchanged.
- **Acceptable trade-off: N session reloads for "Update All".** Today, pi-core's "Update All" sends one POST with N packages, the server runs them serially under one `runExclusive` call, and triggers exactly one session reload at the end. With this change, the client splits "Update All" into N enqueues, each producing its own reload (~1-2 s each). Real N is typically 2-3 in practice (`@mariozechner/pi-coding-agent` + `@blackbelt-technology/pi-agent-dashboard` + `@blackbelt-technology/pi-model-proxy`; the `@oh-my-pi/pi-coding-agent` fork is mutually exclusive with the `@mariozechner` variant). Documented as a trade-off; if it becomes a UX issue, a server-side reload debouncer is a clean follow-up.
- **Channel separation preserved at `useMessageHandler`.** `pi_core_update_progress` / `pi_core_update_complete` continue to dispatch to `pi-core-event`; `package_progress` / `package_operation_complete` continue to dispatch to `pi-package-event`. The queue subscribes to both. We do not unify the channels because the message shapes are different and the channel boundary acts as a useful type discriminator at the routing layer.
- **No protocol changes.** `PackageOperationResponse`, `PackageProgressMessage`, `PackageOperationCompleteMessage`, `PiCoreUpdateProgressMessage`, `PiCoreUpdateCompleteMessage` are all unchanged.
- **No `usePiCoreVersions` refactor.** It already consumes `pi_core_update_complete` for refetch and is unrelated to in-flight tracking.

## Capabilities

### Affected
- `package-install` — the queue's contract gains pi-core support. Source-key prefix convention, kind discriminator, dual event-channel subscription, and global single-flight unification all add new requirements.
- `pi-core-version-ui` — the existing "Update in progress" expectation is reaffirmed and strengthened: pi-core update spinners now persist across `UnifiedPackagesSection` unmount because the underlying state lives in the singleton queue.

### Not affected
- `package-update`, `package-management` — the extension package endpoint contracts are unchanged.
- `pi-core-version-check` — server-side update logic is unchanged.

## Backward compatibility

- No protocol changes — the server is wholly unaffected.
- All existing `packageQueue.enqueue` call sites continue to work with `kind` defaulted to `"extension"`.
- The `usePackageOperations` hook's pre-existing return surface is preserved; `coreUpdate` is purely additive.
- The change is fully reversible by `git revert` of the implementation commit; no data migration, no settings file rewrites, no irreversible state.
