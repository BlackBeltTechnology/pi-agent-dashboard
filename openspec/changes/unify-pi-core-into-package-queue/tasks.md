# Tasks

## 1. Extend `packageQueue` with pi-core support

- [ ] 1.1 In `packages/client/src/lib/package-queue.ts`, extend `RunningOp` and the internal `QueuedOp` type with `kind: "extension" | "pi-core"`. Extend `EnqueueRequest` with `kind?: "extension" | "pi-core"` defaulting to `"extension"`.
- [ ] 1.2 In `enqueue`, propagate `kind` (defaulted to `"extension"`) into `startOperation` and `queue.push`. Existing call sites need no changes.
- [ ] 1.3 In the `PackageQueue` constructor, add `window.addEventListener("pi-core-event", this.onPiCoreEvent)` alongside the existing `pi-package-event` listener. Add a corresponding `removeEventListener` if/when the queue ever exposes a teardown method (it does not today).
- [ ] 1.4 Add `private onPiCoreEvent = (e: Event) => { ... }` that:
  - Reads `(e as CustomEvent).detail` and bails on shape mismatches.
  - For `msg.type === "pi_core_update_progress"`, if `running?.kind === "pi-core" && running.source === "pi-core:" + msg.name`, sets `running.message` to `msg.message ?? "<name>: <phase>"` and notifies subscribers.
  - For `msg.type === "pi_core_update_complete"`, no-op (POST response handles completion).
- [ ] 1.5 Refactor `postOperation` to switch on `op.kind`:
  - Default branch: existing extension flow (POST `/api/packages/${op.action}`, await `package_operation_complete`).
  - `"pi-core"` branch (new): see 1.6.
- [ ] 1.6 Add `private async postPiCoreUpdate(op: QueuedOp & { kind: "pi-core" })`:
  - Extract `name = op.source.slice("pi-core:".length)`.
  - `fetch(POST /api/pi-core/update, { packages: [name] })`. Handle network error → `completeRunning(false, msg)`.
  - Stale guard: if `running?.source !== op.source` after the await, return.
  - On HTTP 409: same retry-once logic as the extension flow (drop running, unshift retried op, schedule second attempt after 500 ms; second 409 → `completeRunning(false, msg)`).
  - On HTTP non-2xx or `body.success === false`: `completeRunning(false, body?.error ?? "HTTP ${status}")`.
  - On success, expect `body.data.results` to be an array of length 1 (we always send single-name batches). If `result.success === true`, `completeRunning(true, undefined, "Update complete")`. Else `completeRunning(false, result.error ?? "Update failed")`.
- [ ] 1.7 Add `isAnyRunning(): boolean` returning `this.running !== null`. Public API; no behavioural change without consumers, but useful primitive for follow-up cross-domain UI lock work.
- [ ] 1.8 Update the existing `matchesRunning` helper signature if needed to skip pi-core entries during extension `package_progress` matching (it should already by virtue of source-prefix-uniqueness; verify with a unit test rather than adding a `kind` check defensively).

## 2. Unit tests for the queue

Add `packages/client/src/lib/__tests__/package-queue-pi-core.test.ts` covering:

- [ ] 2.1 `enqueue({source: "pi-core:pi", kind: "pi-core", action: "update", scope: "global"})` POSTs to `/api/pi-core/update` with body `{packages: ["pi"]}`.
- [ ] 2.2 On HTTP 200 with `body.data.results = [{name: "pi", success: true}]`, the queue transitions to success and clears `running`.
- [ ] 2.3 On HTTP 200 with `body.data.results = [{name: "pi", success: false, error: "boom"}]`, the queue records `error` keyed under `"pi-core:pi"` with the message `"boom"`.
- [ ] 2.4 On HTTP 409 once then 200 success, the queue retries once and succeeds.
- [ ] 2.5 On HTTP 409 twice, the queue records `error` with the server's busy message.
- [ ] 2.6 A `pi_core_update_progress` event for the running op updates `running.message`.
- [ ] 2.7 A `pi_core_update_progress` event for a different name (not the running op) is a no-op.
- [ ] 2.8 A `pi_core_update_complete` event for the running op is a no-op (the POST response handles completion). This test asserts that the queue does NOT prematurely transition based on the WS event.
- [ ] 2.9 An extension op (`{source: "npm:foo", kind: "extension"}`) and a pi-core op queued back-to-back are processed in order; the pi-core dispatch arm is selected based on `kind`, not source.
- [ ] 2.10 `isAnyRunning()` returns `true` while either an extension or a pi-core op is the running op, `false` otherwise.

## 3. `usePackageOperations` hook

- [ ] 3.1 In `packages/client/src/hooks/usePackageOperations.ts`, add `coreUpdate(name: string): void` that calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`.
- [ ] 3.2 Add `coreUpdate` to the hook's return value alongside the existing methods.
- [ ] 3.3 Add a unit test in `packages/client/src/hooks/__tests__/usePackageOperations-pi-core.test.tsx`:
  - `coreUpdate("pi")` triggers the queue's pi-core POST.
  - `runningSource` becomes `"pi-core:pi"` until completion.
  - `statusFor("pi-core:pi")` cycles `"running"` → `"success"` (or `"error"` per response).

## 4. Refactor `UnifiedPackagesSection`

- [ ] 4.1 In `packages/client/src/components/UnifiedPackagesSection.tsx`:
  - Remove the three `useState` calls: `coreUpdating`, `coreProgress`, `coreErrors`.
  - Remove the `pi-core-event` `useEffect` listener block.
  - Remove the `doCoreUpdate` `useCallback`.
  - Remove the `ProgressMap` type import if no longer used.
- [ ] 4.2 Wire each Core sub-group `<PackageRow>` through `usePackageOperations`:
  - `busy={operations.runningSource === "pi-core:" + pkg.name}`
  - `progress={operations.runningSource === "pi-core:" + pkg.name ? operations.operation.message : undefined}`
  - `error={operations.statusFor("pi-core:" + pkg.name) === "error" ? operations.messageFor("pi-core:" + pkg.name) : undefined}`
  - `onUpdate={() => operations.coreUpdate(pkg.name)}`
- [ ] 4.3 Update the "Update All" button:
  - `onClick={() => updatableCore.forEach((p) => operations.coreUpdate(p.name))}`
  - `disabled={operations.queueDepth + (operations.runningSource ? 1 : 0) > 0 || updatableCore.length === 0}`
  - Spinner condition: `operations.queueDepth + (operations.runningSource ? 1 : 0) > 0 && updatableCore.some((p) => operations.statusFor("pi-core:" + p.name) === "running" || operations.statusFor("pi-core:" + p.name) === "queued")`
- [ ] 4.4 Verify the version list refresh on completion: today's component calls `refresh(true)` inside the POST `then`. Verify `usePiCoreVersions`'s existing `pi_core_update_complete` listener still fires the refetch (it does — independent listener on the same channel). No additional wiring needed.

## 5. Component-level integration tests

- [ ] 5.1 Add `packages/client/src/components/__tests__/unified-packages-section-core-survives-unmount.test.tsx`:
  - Render `UnifiedPackagesSection` inside a parent that toggles its mounted state.
  - Click Update on `pi (core agent)`. Assert the row renders busy.
  - Unmount the parent.
  - Remount the parent. Without dispatching new events, assert the row STILL renders busy (the queue's running op survived).
  - Resolve the mocked `fetch` with success. Assert the row clears its busy state.
- [ ] 5.2 Add `packages/client/src/components/__tests__/unified-packages-section-core-cross-domain-queue.test.tsx`:
  - Mock `fetch` to leave the pi-core POST pending.
  - Click Update on a Core row. Assert `runningSource === "pi-core:pi"`.
  - In the same test, click Install on a Recommended-Extensions row.
  - Assert the extension install enters the `queued` state (not `running`, not `error`).
  - Resolve the pi-core POST. Assert the extension install transitions from `queued` to `running` (and POSTs to `/api/packages/install`).

## 6. Documentation

- [ ] 6.1 Update `AGENTS.md`'s entry for `package-queue.ts`:
  - Note that the queue handles both extension and pi-core operations.
  - Mention the `kind` discriminator and the `pi-core:` source-prefix convention.
  - Mention the dual `pi-package-event` + `pi-core-event` subscription.
- [ ] 6.2 Update `AGENTS.md`'s entry for `usePackageOperations.ts` to mention the `coreUpdate(name)` helper.
- [ ] 6.3 Update `AGENTS.md`'s entry for `UnifiedPackagesSection.tsx` to remove the references to local pi-core state and point at `packageQueue` instead.
- [ ] 6.4 Update `docs/architecture.md` if it has a "Package Operations" section that diagrams the state machine; otherwise no change.
- [ ] 6.5 No README.md changes (UX bug fix, not a user-visible feature).

## 7. Validation

- [ ] 7.1 `npm test` passes with all new queue, hook, and component tests added.
- [ ] 7.2 Manual repro of the screenshot scenario:
  1. `Settings → Pi Ecosystem → Core → pi (core agent) → Update`.
  2. Spinner appears.
  3. Navigate to a chat session in the sidebar.
  4. Navigate back to Settings.
  5. **Expected**: pi row still shows the spinner / progress message.
  6. Wait for completion. Row clears, version list refreshes.
- [ ] 7.3 Manual cross-domain check:
  1. Start a pi-core update.
  2. Click Install on a recommended extension while the pi-core update is still running.
  3. **Expected**: the extension row shows the `queued` indicator (not a 409 error). When pi-core finishes, the extension install proceeds automatically.
- [ ] 7.4 Manual "Update All" check: with multiple Core packages updatable, click "Update All". Each pi-core row transitions through `queued` → `running` → success in sequence (not all at once). Total time is roughly N × per-package time.
- [ ] 7.5 `openspec validate unify-pi-core-into-package-queue --strict` passes.
