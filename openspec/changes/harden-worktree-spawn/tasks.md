## 1. Pure helpers (server)

- [x] 1.1 Create `packages/server/src/worktree-bootstrap.ts` with `detectBootstrapRequirement(repoRoot)`, `pickInstallCommand(worktreePath)`, and signature stub for `runBootstrap(worktreePath, onProgress)`.
- [x] 1.2 Add unit tests in `packages/server/src/__tests__/worktree-bootstrap.test.ts` covering: (a) this repo's `.pi/settings.json` → required, (b) npm-only `packages[]` → not required, (c) no `.pi/settings.json` → not required, (d) malformed JSON → not required (fail-open). 
- [x] 1.3 Add unit tests for `pickInstallCommand`: returns `npm ci` for `package-lock.json`, `pnpm install --frozen-lockfile` for `pnpm-lock.yaml`, etc., `null` for none.
- [x] 1.4 Create `packages/server/src/worktree-bootstrap-errors.ts` with stderr→hint mapping (`EACCES`, lockfile drift, `engine`, `ETARGET`). Cover with table-driven tests.

## 2. Bootstrap-status probe endpoint

- [x] 2.1 Add `GET /api/git/worktree/bootstrap-status` handler in `packages/server/src/routes/git-routes.ts`. Validate cwd via existing `validateCwd`, gate on loopback / trusted-bypass.
- [x] 2.2 Implement decision tree per spec (`detectBootstrapRequirement` → `node_modules` existence → lockfile staleness).
- [x] 2.3 Add route test in `packages/server/src/__tests__/routes-git-bootstrap-status.test.ts`: cover `not_required`, `ok`, `no_node_modules`, `stale_lockfile`, off-loopback 403.

## 3. Bootstrap execution + progress streaming

- [x] 3.1 Implement `runBootstrap` using `child_process.spawn` with the picked install command. Capture combined stdout/stderr ring buffer (4 KB).
- [x] 3.2 Implement progress throttling: emit at most once per 250 ms per call; flush final partial on exit.
- [x] 3.3 Add `worktree_bootstrap_progress` / `worktree_bootstrap_done` / `worktree_bootstrap_failed` message types to `packages/shared/src/browser-protocol.ts` `ServerToBrowserMessage` union; plus `worktree_bootstrap_subscribe` / `worktree_bootstrap_unsubscribe` on the browser-to-server side. (Renamed from spec's `bootstrap_*` to avoid collision with existing pi-core `bootstrap_status_update` messages.)
- [x] 3.4 Wire progress callback to the requesting browser via a dedicated `WorktreeBootstrapRegistry` (`packages/server/src/worktree-bootstrap-registry.ts`). Browser subscribes by `requestId` over the WS before issuing the HTTP request; registry maps to ws; drops on close + TTL.
- [x] 3.5 Unit-test `runBootstrap`: success exit 0 → `{ ok: true, durationMs }`, failure exit 1 → `{ ok: false, code, stderr }`, throttling under sustained flood, final flush, spawn_error. Plus 7 registry tests.

## 4. Wire bootstrap into `POST /api/git/worktree`

- [x] 4.1 Extend request body parsing in `routes/git-routes.ts` to accept optional `requestId: string`.
- [x] 4.2 After `addWorktree` returns success, call `detectBootstrapRequirement` against the parent repo root.
- [x] 4.3 When required, pick install command in the new worktree; emit `worktree_bootstrap_progress` events while it runs; respond after done / failed.
- [x] 4.4 Extend `POST /api/git/worktree` response shape with `bootstrap: { ran, durationMs?, skippedReason? }`.
- [x] 4.5 Add `bootstrap_failed` to the documented stable error codes list (response shape only; spec text already covered).
- [x] 4.6 Existing route tests already assert via `toMatchObject`/specific fields; verified they still pass (10/10 in `git-worktree-routes.test.ts`).
- [x] 4.7 Added route test: bootstrap repo with no lockfile → `bootstrap: { ran: false, skippedReason: "no_lockfile" }`.
- [x] 4.8 Added route test: bootstrap failure → response `{ success: false, code: "bootstrap_failed", stderr }` (defensive skip when local npm tolerates the broken lockfile).

## 5. Dialog per-row probe + degraded action button

- [x] 5.1 Add `fetchWorktreeBootstrapStatus(cwd)` + `bootstrapExistingWorktree(...)` + `BootstrapStatus` / `BootstrapInfo` / `BootstrapExistingResult` types to `packages/client/src/lib/git-api.ts`.
- [x] 5.2 In `WorktreeSpawnDialog.tsx`, fire one probe per existing worktree row in parallel with the existing fetches. Store results keyed by row path; map null = in-flight.
- [x] 5.3 Replace `Spawn →` button with `⚠ Install deps + Spawn →` for `no_node_modules` / `stale_lockfile` rows. Added `data-testid="worktree-row-<encoded>-needs-bootstrap"` marker.
- [x] 5.4 Click handler for the degraded variant routes through `bootstrapExistingWorktree(...)` then auto-spawns on bus `worktree_bootstrap_done`. Inline; no extracted hook (kept dialog state cohesive instead).
- [x] 5.5 Probe rejection drops the in-flight entry so the row renders the default `Spawn →` button unchanged.
- [x] 5.6 Component tests: healthy row keeps Spawn, `no_node_modules` shows ⚠ variant, probe rejection fail-open.

## 6. Dialog bootstrap-progress surface

- [x] 6.1 Inline bootstrap-progress surface rendered inside the dialog when `bootstrap.phase === "installing"`. Live tail in monospace fixed-height scroll. (`BootstrapProgressPanel` sub-component not extracted; kept inline for cohesion.)
- [x] 6.2 `WorktreeSpawnDialog` subscribes to the `worktree-bootstrap-bus` for the current `requestId`. `useMessageHandler` extended with three new switch cases that dispatch into the bus.
- [x] 6.3 `Create + Spawn →` label changes to `Installing…` and button disabled while `bootstrap.phase === "installing"`.
- [x] 6.4 On `worktree_bootstrap_done`, dialog calls `onSpawn(res.path, { gitWorktreeBase: base })`.
- [x] 6.5 On `worktree_bootstrap_failed`, dialog renders error in new `worktree-dialog-bootstrap-error` surface; does NOT spawn.
- [x] 6.6 Cancel during bootstrap unmounts the dialog; bus subscription cleanup unsubscribes via the bus's per-listener teardown. (Server-side install continues by design.)
- [x] 6.7 Skipped-bootstrap path: `bootstrap.ran === false` in HTTP response causes immediate `onSpawn` and no progress surface.
- [x] 6.8 Component tests: progress events render in tail, done triggers onSpawn, failed shows error suppresses spawn, Create+Spawn forwards requestId, bootstrap.ran=false short-circuits.

## 7. Global toast for off-screen spawn errors

- [x] 7.1 Added pure `isVisibleCwd(cwd, inputs)` in `packages/client/src/lib/cwd-visibility.ts`. Exported `pathKey` from `session-grouping.ts`. 8 tests cover trailing-slash drift, Windows case drift, linux case-sensitivity.
- [x] 7.2 `useMessageHandler.case "spawn_error"` now reads `cwdVisibilityInputsRef` (live snapshot built in App.tsx) and dispatches a global toast via `pushSpawnErrorToast` when the cwd is off-screen. Per-folder banner channel unchanged.
- [x] 7.3 Toast message body truncated to <= 200 chars; format `"Spawn failed at <cwd>: <code> — <message>"`. (Spec also called for duration >= 10000ms — implemented in `spawn-error-toast-bus.ts` as `SPAWN_ERROR_TOAST_DURATION_MS = 10_000`.)
- [x] 7.4 De-dup by `requestId`: if a retry arrives with the same id, the prior bus entry is filtered out. (No `requestId` in current `spawn_error` payload so de-dup only fires on future versions that add one; harmless today.)
- [x] 7.5 7 tests cover: visible cwd (pinned / workspace / session) suppresses toast, off-screen fires toast, trailing-slash drift, missing visibility ref (back-compat), truncation.
- [x] 7.6 Added `<SpawnErrorToastHost />` mounted near app root; bus singleton drives rendering. Independent from the existing 3 s `Toast` used by SessionList.

## 8. Docs

- [x] 8.1 Appended FAQ entry to `docs/faq.md`: "+Worktree dialog: spawn appears to do nothing for sibling worktrees of pi-agent-dashboard". Covers root cause + fix + manual recovery.
- [x] 8.2 Updated `docs/file-index-server.md`: extended `git-routes.ts` row with new endpoints + `bootstrap_failed` code; annotated `git-operations.ts` row for `resolveMainPath` export; added rows for `worktree-bootstrap.ts`, `worktree-bootstrap-errors.ts`, `worktree-bootstrap-registry.ts`.
- [x] 8.3 Updated `docs/file-index-client.md`: extended `WorktreeSpawnDialog.tsx` row with bootstrap probe + degraded button + progress surface; added rows for `SpawnErrorToastHost.tsx`, `cwd-visibility.ts`, `spawn-error-toast-bus.ts`, `worktree-bootstrap-bus.ts`, `useMessageHandler.ts`; annotated `git-api.ts` + `session-grouping.ts` (pathKey export) + `App.tsx`.
- [x] 8.4 Updated `docs/file-index-shared.md` `browser-protocol.ts` row with five new message types (3 server→browser + 2 browser→server). Noted distinction from pi-core bootstrap messages.

## 9. Verify

- [x] 9.1 `npm test`: 6692 passed / 19 skipped / 1 failure. Sole failure (`no-direct-platform-branch.test.ts` flagging `packages/server/src/git-worktree.ts:117`) is **pre-existing uncommitted WIP unrelated to this change** — blame shows the line as "Not Committed Yet" before my work started; it lives in a function I never touched (`isSameWorktreePath`). Surgical-changes rule: leave it for whoever owns that WIP. Every test added by harden-worktree-spawn is green (61 new: 27 worktree-bootstrap helpers, 9 routes-bootstrap-status, 7 run-bootstrap, 7 registry, 8 cwd-visibility, 8 dialog, 7 spawn-error-toast, 3 routes-worktree-bootstrap).
- [ ] 9.2 Manual repro: in this repo, click +Worktree → Create + Spawn → on a fresh branch → see `Installing…` → see live tail of `npm ci` → on done, session card appears in the folder list. (Requires running dashboard; not executed in this session.)
- [ ] 9.3 Manual repro: open +Worktree dialog → existing sibling-worktree row (no `node_modules`) shows `⚠ Install deps + Spawn →` → click → install → spawn → card appears. (Requires running dashboard; not executed in this session.)
- [ ] 9.4 Manual repro: pick a cwd not in any workspace, force a spawn failure → toast appears with cwd + error code. (Requires running dashboard; not executed in this session.)
- [x] 9.5 `openspec validate harden-worktree-spawn` is green.
