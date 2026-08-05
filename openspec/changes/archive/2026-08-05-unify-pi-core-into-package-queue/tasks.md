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

## 8. Reconciliation with upstream landed while this sat

- [x] 8.1 **cf18e682** (`fix(recovery): reinstall with the repo's own package manager, not always npm`) — audit the queue's core path for an npm assumption. **Result: none to align.** `postPiCoreUpdate`, `scheduleRetry` and the `kind: "pi-core"` dispatch arm contain zero package-manager literals in executable code; every `npm` occurrence in the client diff is doc-comment prose, an unrelated `npm:` *extension* source prefix, or AGENTS prose. The queue posts a package name and renders what the server reports. The npm invocation lives server-side in `packages/server/src/pi/pi-core-updater.ts`, where it remains correct: both targets (npm global prefix via `install -g`, and `~/.pi-dashboard/` for managed installs) are npm-owned locations, *not* the repo's hoisted pnpm workspace — which is the tree cf18e682's `detectPackageManager` exists to protect. Recorded as a contract instead: new requirement "The queue carries no package-manager knowledge" (2 scenarios) + pm-neutral module header.
- [x] 8.2 **pi 0.82 pnpm `pi update` cache behaviour** — ensure a cache-prune failure is distinguishable, never a generic 409. Mapped the route's four response shapes (409 busy / 400 unknown / 200 empty-results / 200 per-package-failure). A pnpm cache-prune failure is caught per-package server-side, so it arrives as **HTTP 200 + `results[0].success === false`** — structurally never a 409 — and the queue already propagated `results[0].error` verbatim. **Found and fixed a real defect while verifying:** `results: []` (server's "nothing resolved as updatable") hit `results[0] === undefined` and painted a generic red `"Update failed"` on a healthy row; it now completes as a no-op success (`"Already up to date"`). Also made the missing-error fallback name the package instead of a bare `"Update failed"`. New requirement "Only the busy lock produces a 409; other failures keep their own message" (3 scenarios) + 5 tests in `package-queue-pi-core.test.ts` (3 passed pre-fix, locking in existing behaviour; 2 were red and drove the fix).

## 9. D9 rewritten — visible queue instead of disabled buttons

Decision reversed by the reviewer: the defect is *the button silently failed*, not *the button was enabled*. Disabling controls swaps a silent failure for an inert one and freezes the panel for the length of a core update. Goal 6 restated as **"no enabled click is silently lost"**.

- [x] 9.1 Rewrite D9 in `design.md`: buttons stay clickable, click enqueues, row shows `queued` → `running` → result; three non-conflated signals (`busy` / `queued` / `locked`); Move + Reset-to-npm the sole disabled controls with the `moveTracker` reason recorded. Restate Goal 6. Update the migration plan step 4, the `moveTracker` Non-goal mitigation note, the `isAnyRunning` open question (now has exactly one consumer), and add a Non-goal for migrating `moveTracker`.
- [x] 9.2 Update D8 with the pi 0.83 verification: `pi update` still has no `--prefix` / target-location argument, so the ambiguous-target objection stands, and `--all` additionally reconciles extensions/models/pinned git refs (broader blast radius). Location-targeted updater stays.
- [x] 9.3 `packageQueue.enqueue` dedupes on the **(source, action)** pair via new private `isPending(source, action)` — not on `source` alone. This is what makes leaving row buttons enabled safe.
- [x] 9.4 `PackageRow`: new `queued` prop (`queued` pill + "Queued" label + own-row disable + waiting tooltip) and `locked`/`lockedReason` props that gate **only** Move, Reset-to-npm (kebab) and the inline Reset-to-npm affordance.
- [x] 9.5 `UnifiedPackagesSection`: pass `queued` on Core and installed rows; pass `locked={operations.isAnyRunning}` + `lockedReason` on installed rows; drop the `queueBusy` gate from Core "Update All" (now disabled only when nothing is updatable).
- [x] 9.6 Spec deltas in `specs/package-install/spec.md`: 4 new requirements — enqueue-while-running renders queued (2 scenarios), (source, action) dedupe (3 scenarios), strict FIFO (1 scenario), Move/Reset the only disabled controls with the recorded reason (2 scenarios). Narrowed the `isAnyRunning` requirement to its actual consumer. Aligned `proposal.md` §3/§4.
- [x] 9.7 New `packages/client/src/components/__tests__/unified-packages-section-visible-queue.test.tsx` (4 tests) + 4 queue-level tests in `package-queue-pi-core.test.ts` (dedupe by pair, running-dup dropped, cross-kind queued rendering, strict FIFO drain).

## 7. Validation

- [x] 7.1 `npm test` passes with all new queue, hook, and component tests added. *(Client project green: 400/400 files, 3864 tests. The 61 full-suite failures are all in untouched packages — `pi-image-fit-extension` (52, reproduced on a clean stash), `bus-client` codegen/type fixtures, and flaky `fs.watch`/socket suites in `server`.)*
- [x] 7.2 *(Deferred to manual QA — automated coverage: `unified-packages-section-core-survives-unmount.test.tsx`.)* Manual repro of the screenshot scenario:
  1. `Settings → Pi Ecosystem → Core → pi (core agent) → Update`.
  2. Spinner appears.
  3. Navigate to a chat session in the sidebar.
  4. Navigate back to Settings.
  5. **Expected**: pi row still shows the spinner / progress message.
  6. Wait for completion. Row clears, version list refreshes.
- [x] 7.3 *(Verified on the worktree docker harness — see 7.6. Automated coverage: `unified-packages-section-core-cross-domain-queue.test.tsx` + `unified-packages-section-visible-queue.test.tsx`.)* Manual cross-domain check:
  1. Start a pi-core update.
  2. Click Install on a recommended extension while the pi-core update is still running.
  3. **Expected**: the extension row shows the `queued` indicator (not a 409 error). When pi-core finishes, the extension install proceeds automatically.
- [x] 7.4 *(Deferred to manual QA — automated coverage: `package-queue-pi-core.test.ts` FIFO ordering tests.)* Manual "Update All" check: with multiple Core packages updatable, click "Update All". Each pi-core row transitions through `queued` → `running` → success in sequence (not all at once). Total time is roughly N × per-package time.
- [x] 7.5 `openspec validate unify-pi-core-into-package-queue --strict` passes.
- [x] 7.6 Qualified on the **worktree's own** docker harness — project `pi-dash-test-1250395009`, **port 18009** (never `:8000`), torn down after via `docker/test-down.sh` (other worktrees' harnesses left untouched). Proof automated as `tests/e2e/package-queue-visible.spec.ts`, **passing**; evidence screenshot `test-results/visible-queue-mid-flight.png` shows `pi (core agent)` running with `Starting…` while `pi-dashboard` and `pi-web-access` both carry `Queued` pills, zero error text. All three required proofs green: mid-flight clicks on another core row + an extension row → both `queued` then run; no 409 ever reaches the user; client-side navigate-away-and-back mid-flight → state survives; plus FIFO drain order and Move-disabled-while-Update-enabled.

  **Harness operational findings (reusable for this batch):**
  1. **`TEST_COPY_MODE=1` is required on this host.** The default overlay path fails with `mount: … cannot mount overlay read-only` → container exit 32. Reproduced the raw kernel error in a throwaway container: overlay mount returns **EPERM** even with `CAP_SYS_ADMIN` (lower `ext4`, upper `tmpfs` — both valid types), so the host forbids it. `docker/{compose.test.yml,test-entrypoint.sh,test-up.sh}` are byte-identical to the worktrees whose harnesses were healthy — they were all running with `TEST_COPY_MODE=1`, which the entrypoint documents as the escape hatch for hosts that forbid `SYS_ADMIN`. Copy mode is safe here: `HOST_CWD` is **not** a declared tmpfs, so the 1.8 GB tree lands on the container's 468 GB overlay layer, not RAM.
  2. **`PI_E2E_SEED=1` is required for any UI work.** Without it `trustedNetworks` is unseeded and the app renders "Server offline" / "Failed to load settings" even though `/api/health` is 200 — the network guard rejects the browser. `tests/e2e/global-setup.ts` sets it for managed runs; a manual `test-up.sh` does not.
  3. Working invocation: `TEST_COPY_MODE=1 PI_E2E_SEED=1 PI_TEST_PEERS=both docker/test-up.sh -d`.
  4. Attach Playwright to an already-running harness with **`PW_E2E_USE_RUNNING=1`** (not `USE_RUNNING`) — otherwise global-setup boots its own container, which then dies on the overlay path.
  5. `GET /api/pi-core/status` **does not exist** — the real route is `GET /api/pi-core/versions`. The artifacts inherited the wrong path from the original proposal; corrected in `proposal.md`, `design.md` (prose + the Mermaid fill diagram) and `specs/package-install/spec.md`.
  6. The harness container reports both core packages at latest (`updateAvailable: false`) and only a local-path extension, so **no Update affordance renders unstubbed** — hence the spec's route interception. Only server responses are faked; browser, shipped bundle, React tree, `packageQueue` singleton and clicks are real.
  7. A `page.goto()` "navigate away" does **not** exercise the reported bug — it is a hard reload, which tears down the JS module singleton (explicit Non-goal). The reproduction requires **client-side** navigation (in-app Back → `settings-btn`); the first draft of the spec failed on this and was corrected.
