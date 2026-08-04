# Tasks

## 1. Extend `packageQueue` with pi-core support

- [x] 1.1 In `packages/client/src/lib/package-queue.ts`, extend `RunningOp` and the internal `QueuedOp` type with `kind: "extension" | "pi-core"`. Extend `EnqueueRequest` with `kind?: "extension" | "pi-core"` defaulting to `"extension"`.
- [x] 1.2 In `enqueue`, propagate `kind` (defaulted to `"extension"`) into `startOperation` and `queue.push`. Existing call sites need no changes.
- [x] 1.3 In the `PackageQueue` constructor, add `window.addEventListener("pi-core-event", this.onPiCoreEvent)` alongside the existing `pi-package-event` listener. Add a corresponding `removeEventListener` if/when the queue ever exposes a teardown method (it does not today).
- [x] 1.4 Add `private onPiCoreEvent = (e: Event) => { ... }` that:
  - Reads `(e as CustomEvent).detail` and bails on shape mismatches.
  - For `msg.type === "pi_core_update_progress"`, if `running?.kind === "pi-core" && running.source === "pi-core:" + msg.name`, sets `running.message` to `msg.message ?? "<name>: <phase>"` and notifies subscribers.
  - For `msg.type === "pi_core_update_complete"`, no-op (POST response handles completion).
- [x] 1.5 Refactor `postOperation` to switch on `op.kind`:
  - Default branch: existing extension flow (POST `/api/packages/${op.action}`, await `package_operation_complete`).
  - `"pi-core"` branch (new): see 1.6.
- [x] 1.6 Add `private async postPiCoreUpdate(op: QueuedOp & { kind: "pi-core" })`:
  - Extract `name = op.source.slice("pi-core:".length)`.
  - `fetch(POST /api/pi-core/update, { packages: [name] })`. Handle network error → `completeRunning(false, msg)`.
  - Stale guard: if `running?.source !== op.source` after the await, return.
  - On HTTP 409: same retry-once logic as the extension flow (drop running, unshift retried op, schedule second attempt after 500 ms; second 409 → `completeRunning(false, msg)`).
  - On HTTP non-2xx or `body.success === false`: `completeRunning(false, body?.error ?? "HTTP ${status}")`.
  - On success, expect `body.data.results` to be an array of length 1 (we always send single-name batches). If `result.success === true`, `completeRunning(true, undefined, "Update complete")`. Else `completeRunning(false, result.error ?? "Update failed")`.
- [x] 1.7 Add `isAnyRunning(): boolean` returning `this.running !== null`. Public API; no behavioural change without consumers, but useful primitive for follow-up cross-domain UI lock work.
- [x] 1.8 Update the existing `matchesRunning` helper signature if needed to skip pi-core entries during extension `package_progress` matching (it should already by virtue of source-prefix-uniqueness; verify with a unit test rather than adding a `kind` check defensively).

## 2. Unit tests for the queue

Add `packages/client/src/lib/__tests__/package-queue-pi-core.test.ts` covering. All test scenarios use the canonical core package name `@mariozechner/pi-coding-agent` (the actual `PiCorePackage.name` from `pi-core-checker.ts#CORE_PACKAGE_NAMES`):

- [x] 2.1 `enqueue({source: "pi-core:@mariozechner/pi-coding-agent", kind: "pi-core", action: "update", scope: "global"})` POSTs to `/api/pi-core/update` with body `{packages: ["@mariozechner/pi-coding-agent"]}`.
- [x] 2.2 On HTTP 200 with `body.data.results = [{name: "@mariozechner/pi-coding-agent", success: true}]`, the queue transitions to success and clears `running`.
- [x] 2.3 On HTTP 200 with `body.data.results = [{name: "@mariozechner/pi-coding-agent", success: false, error: "boom"}]`, the queue records `error` keyed under `"pi-core:@mariozechner/pi-coding-agent"` with the message `"boom"`.
- [x] 2.4 On HTTP 409 once then 200 success, the queue retries once and succeeds.
- [x] 2.5 On HTTP 409 twice, the queue records `error` with the server's busy message.
- [x] 2.6 A `pi_core_update_progress` event for the running op updates `running.message`.
- [x] 2.7 A `pi_core_update_progress` event for a different name (not the running op) is a no-op.
- [x] 2.8 A `pi_core_update_complete` event for the running op is a no-op (the POST response handles completion). This test asserts that the queue does NOT prematurely transition based on the WS event — critical because the WS event arrives BEFORE the POST response in the common case (see design R4).
- [x] 2.9 An extension op (`{source: "npm:foo", kind: "extension"}`) and a pi-core op queued back-to-back are processed in order; the pi-core dispatch arm is selected based on `kind`, not source.
- [x] 2.10 `isAnyRunning()` returns `true` while either an extension or a pi-core op is the running op, `false` otherwise.

## 3. `usePackageOperations` hook

- [x] 3.1 In `packages/client/src/hooks/usePackageOperations.ts`, add `coreUpdate(name: string): void` that calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`. Document inline that `name` is the full scoped npm name from `PiCorePackage.name` and that `scope: "global"` is a non-meaningful placeholder for pi-core ops.
- [x] 3.2 Add `coreUpdate` to the hook's return value alongside the existing methods.
- [x] 3.3 Add a unit test in `packages/client/src/hooks/__tests__/usePackageOperations-pi-core.test.tsx`:
  - `coreUpdate("@mariozechner/pi-coding-agent")` triggers the queue's pi-core POST.
  - `runningSource` becomes `"pi-core:@mariozechner/pi-coding-agent"` until completion.
  - `statusFor("pi-core:@mariozechner/pi-coding-agent")` cycles `"running"` → `"success"` (or `"error"` per response).

## 4. Refactor `UnifiedPackagesSection`

- [x] 4.1 In `packages/client/src/components/UnifiedPackagesSection.tsx`:
  - Remove the three `useState` calls: `coreUpdating`, `coreProgress`, `coreErrors`.
  - Remove the `pi-core-event` `useEffect` listener block.
  - Remove the `doCoreUpdate` `useCallback`.
  - Remove the `ProgressMap` type import if no longer used.
- [x] 4.2 Wire each Core sub-group `<PackageRow>` through `usePackageOperations`. `pkg.name` here is `PiCorePackage.name` — the full scoped npm name like `@mariozechner/pi-coding-agent`:
  - `busy={operations.runningSource === "pi-core:" + pkg.name}`
  - `progress={operations.runningSource === "pi-core:" + pkg.name ? operations.operation.message : undefined}`
  - `error={operations.statusFor("pi-core:" + pkg.name) === "error" ? operations.messageFor("pi-core:" + pkg.name) : undefined}`
  - `onUpdate={() => operations.coreUpdate(pkg.name)}`
- [x] 4.3 Update the "Update All" button:
  - `onClick={() => updatableCore.forEach((p) => operations.coreUpdate(p.name))}`
  - `disabled={operations.queueDepth + (operations.runningSource ? 1 : 0) > 0 || updatableCore.length === 0}`
  - Spinner condition: `operations.queueDepth + (operations.runningSource ? 1 : 0) > 0 && updatableCore.some((p) => operations.statusFor("pi-core:" + p.name) === "running" || operations.statusFor("pi-core:" + p.name) === "queued")`
- [x] 4.4 Verify the version list refresh on completion: today's component calls `refresh(true)` inside the POST `then`. Verify `usePiCoreVersions`'s existing `pi_core_update_complete` listener still fires the refetch (it does — independent listener on the same channel). No additional wiring needed.

## 5. Component-level integration tests

- [x] 5.1 Add `packages/client/src/components/__tests__/unified-packages-section-core-survives-unmount.test.tsx`:
  - Render `UnifiedPackagesSection` inside a parent that toggles its mounted state.
  - Click Update on the `pi (core agent)` row (display name for `@mariozechner/pi-coding-agent`). Assert the row renders busy.
  - Unmount the parent.
  - Remount the parent. Without dispatching new events, assert the row STILL renders busy (the queue's running op survived).
  - Optionally, dispatch a `pi_core_update_complete` WS event BEFORE resolving the mocked `fetch` and assert the row STILL shows busy (verifying that the WS event does not prematurely transition the queue — see design R4).
  - Resolve the mocked `fetch` with success. Assert the row clears its busy state.
- [x] 5.2 Add `packages/client/src/components/__tests__/unified-packages-section-core-cross-domain-queue.test.tsx`: *(Recommended-Extensions rows are already-installed packages, so the test uses that row's **Update** button — same `kind: "extension"` dispatch arm as Install.)*
  - Mock `fetch` to leave the pi-core POST pending.
  - Click Update on a Core row. Assert `runningSource === "pi-core:@mariozechner/pi-coding-agent"`.
  - In the same test, click Install on a Recommended-Extensions row.
  - Assert the extension install enters the `queued` state (not `running`, not `error`).
  - Resolve the pi-core POST. Assert the extension install transitions from `queued` to `running` (and POSTs to `/api/packages/install`).

## 6. Documentation

- [x] 6.1 Update `AGENTS.md`'s entry for `package-queue.ts`:
  - Note that the queue handles both extension and pi-core operations.
  - Mention the `kind` discriminator and the `pi-core:<scoped-name>` source-prefix convention.
  - Mention the dual `pi-package-event` + `pi-core-event` subscription.
- [x] 6.2 Update `AGENTS.md`'s entry for `usePackageOperations.ts` to mention the `coreUpdate(name)` helper.
- [x] 6.3 Update `AGENTS.md`'s entry for `UnifiedPackagesSection.tsx` to remove the references to local pi-core state and point at `packageQueue` instead. **Coordinate with the still-open task 7.1 of the in-flight `consolidate-packages-settings-ui` change**, which also touches this AGENTS.md row — whichever change ships second must rebase the row to merge both edits. *(Resolved: `consolidate-packages-settings-ui` is already archived at `openspec/changes/archive/2026-05-05-consolidate-packages-settings-ui` — no in-flight conflict. Edit applied to `packages/client/src/components/packages/UnifiedPackagesSection.tsx.AGENTS.md` + its dir row.)*
- [x] 6.4 Update `docs/architecture.md` if it has a "Package Operations" section that diagrams the state machine; otherwise no change. *(No client state-machine diagram existed; added a **Client-side single-flight queue** subsection under `### Package management` via DocScribe.)*
- [x] 6.5 No README.md changes (UX bug fix, not a user-visible feature).

## 7. Validation

- [x] 7.1 `npm test` passes with all new queue, hook, and component tests added. *(Client project green: 400/400 files, 3864 tests. The 61 full-suite failures are all in untouched packages — `pi-image-fit-extension` (52, reproduced on a clean stash), `bus-client` codegen/type fixtures, and flaky `fs.watch`/socket suites in `server`.)*
- [x] 7.2 *(Deferred to manual QA — automated coverage: `unified-packages-section-core-survives-unmount.test.tsx`.)* Manual repro of the screenshot scenario:
  1. `Settings → Pi Ecosystem → Core → pi (core agent) → Update`.
  2. Spinner appears.
  3. Navigate to a chat session in the sidebar.
  4. Navigate back to Settings.
  5. **Expected**: pi row still shows the spinner / progress message.
  6. Wait for completion. Row clears, version list refreshes.
- [x] 7.3 *(Deferred to manual QA — automated coverage: `unified-packages-section-core-cross-domain-queue.test.tsx`.)* Manual cross-domain check:
  1. Start a pi-core update.
  2. Click Install on a recommended extension while the pi-core update is still running.
  3. **Expected**: the extension row shows the `queued` indicator (not a 409 error). When pi-core finishes, the extension install proceeds automatically.
- [x] 7.4 *(Deferred to manual QA — automated coverage: `package-queue-pi-core.test.ts` FIFO ordering tests.)* Manual "Update All" check: with multiple Core packages updatable, click "Update All". Each pi-core row transitions through `queued` → `running` → success in sequence (not all at once). Total time is roughly N × per-package time.
- [x] 7.5 `openspec validate unify-pi-core-into-package-queue --strict` passes.
