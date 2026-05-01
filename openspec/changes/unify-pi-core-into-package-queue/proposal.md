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
- Pi-core operations key as `pi-core:${packageName}` (e.g. `pi-core:pi`, `pi-core:pi-dashboard`). The prefix is canonical and self-documenting; the `kind` field is the actual dispatch key but the prefix lets human readers grep.
- `postOperation` dispatches by `kind`:
  - `"extension"` → existing flow: POST `/api/packages/{action}` → wait for `package_operation_complete` WS event.
  - `"pi-core"` → new flow: POST `/api/pi-core/update` with `{packages: [name]}` → completion is signalled by the POST response itself (the pi-core endpoint is synchronous from the client's perspective; it returns when the update has actually finished).
- The 409 retry-once policy applies uniformly to both flows.
- `onWindowEvent` adds two new arms for `pi-core-event`:
  - `pi_core_update_progress {name, phase, message?}` → if `running.source === "pi-core:" + name`, update `running.message`. Otherwise no-op.
  - `pi_core_update_complete` → no-op for queue tracking (the POST response handles completion). Other consumers (e.g. `usePiCoreVersions`) continue to listen for refetch purposes; they're unaffected.

### 2. `usePackageOperations` gains a typed pi-core helper

- Add `coreUpdate(name: string): void` that calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`.
- All existing API on the hook is preserved.

### 3. `UnifiedPackagesSection` deletes its pi-core state

- Remove `useState` for `coreUpdating`, `coreProgress`, `coreErrors`.
- Remove the `pi-core-event` `useEffect` listener (the queue owns it).
- Remove the local `doCoreUpdate` `useCallback`.
- Wire Core sub-group `<PackageRow>` props through `usePackageOperations`:
  - `busy={operations.runningSource === "pi-core:" + pkg.name}`
  - `progress={operations.runningSource === "pi-core:" + pkg.name ? operations.operation.message : undefined}`
  - `error={operations.statusFor("pi-core:" + pkg.name) === "error" ? operations.messageFor("pi-core:" + pkg.name) : undefined}`
  - `onUpdate={() => operations.coreUpdate(pkg.name)}`
- "Update All" iterates over `updatableCore` and calls `operations.coreUpdate(name)` for each. The queue handles FIFO serialization automatically. The button's `disabled` becomes `operations.queueDepth + (operations.runningSource ? 1 : 0) > 0`.

### 4. Extension install/uninstall buttons are gated while pi-core updates run, and vice versa

This falls out of (1) for free: the queue's existing single-flight contract now spans both kinds. While a pi-core update is the running op, an extension install enqueued from any other surface enters the `queued` state automatically. The user no longer sees a 409 for clicking install during a core update — the install just queues until the core update finishes.

### Scope guardrails

- **`moveTracker` stays separate.** Moves use a different identity scheme (`moveId`-keyed, partial-success semantics) and a different REST endpoint with composite phases. Bringing moves into the queue would be a larger change with no bug-fix justification.
- **No server-side changes.** The `/api/pi-core/update` endpoint accepts batch input today; we choose to call it with single-name batches from the client, but we don't break the batch shape for any other consumer. The endpoint and the `PiCoreUpdater` class are unchanged.
- **Acceptable trade-off: N session reloads for "Update All".** Today, pi-core's "Update All" sends one POST with N packages, the server runs them serially under one `runExclusive` call, and triggers exactly one session reload at the end. With this change, the client splits "Update All" into N enqueues, each producing its own reload (~1-2 s each, N typically 2-3). Documented as a trade-off; if it becomes a UX issue, a server-side reload debouncer is a clean follow-up.
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
