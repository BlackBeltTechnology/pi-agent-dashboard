## 1. Scanner: exclusion set + Unix defaults

- [ ] 1.1 Extend `ScanOptions` in `packages/extension/src/process-scanner.ts` with `excludedPgids?: Set<number>`. Thread it from `scanChildProcesses` → `captureChildPgids` and `scanTrackedProcesses`.
- [ ] 1.2 In `captureChildPgids`, after `parseInt(line.trim(), 10)` yields a PGID, refuse to add it to `trackedPgids` when `excludedPgids?.has(pgid)`.
- [ ] 1.3 In `scanTrackedProcesses`, after the existing bash/sh wrapper skip, also `continue` when `excludedPgids?.has(info.pgid)` (defense-in-depth against spawn→register race).
- [ ] 1.4 In `scanTrackedProcesses`, after pruning dead PGIDs from `trackedPgids`, also drop any PGID in `excludedPgids` whose `alivePgids` check missed (iterate `excludedPgids` against the same `alivePgids` set; ps already returns every alive process).
- [ ] 1.5 Keep `DEFAULT_MIN_ELAPSED_MS = 30_000` unchanged (Windows-safe default for callers that don't override).
- [ ] 1.6 Unit test: pure scanner test with mocked `_spawnSync` — capture refuses excluded PGID, filter skips excluded PGID, dead excluded PGID reaped.

## 2. Bridge: platform-aware timer + self-spawn registry

- [ ] 2.1 Add `selfSpawnedPgids: Set<number>` field to `BridgeContext` in `packages/extension/src/bridge-context.ts`. Initialize as empty Set in the bridge state constructor.
- [ ] 2.2 In `packages/extension/src/bridge.ts`, replace `const PROCESS_SCAN_INTERVAL = 10_000;` with platform-aware constants: `PROCESS_SCAN_INTERVAL = win32 ? 10_000 : 5_000`, `PROCESS_MIN_ELAPSED_MS = win32 ? 30_000 : 5_000`.
- [ ] 2.3 Update the `processScanTimer` setInterval callback to pass `PROCESS_MIN_ELAPSED_MS` and `{ excludedPgids: selfSpawnedPgids }` (option bag) to `scanChildProcesses`.
- [ ] 2.4 Verify the existing timer cleanup path covers the renamed/added constants (no behavior change expected).

## 3. Register self-spawned PIDs at known callsites

- [ ] 3.1 In `packages/extension/src/server-launcher.ts`, after the underlying `launchDashboardServer` call returns the spawned child pid, call `bridgeContext.selfSpawnedPgids.add(child.pid)` synchronously before any readiness `await`. Confirm the actual return-shape from `packages/shared/src/server-launcher.ts` (`child.pid`) is exposed in the launcher result; if not, surface it.
- [ ] 3.2 Audit RPC keeper spawn paths: locate every callsite in `packages/extension/` (and `packages/server/src/rpc-keeper/keeper-manager.ts` when invoked from a bridge process) that spawns a `keeper.cjs`. Register each returned `child.pid` into `selfSpawnedPgids` immediately after spawn.
- [ ] 3.3 If a keeper or server is spawned *before* `selfSpawnedPgids` exists on `BridgeContext` (init-order), guard with optional chaining and document. Otherwise no behavior change.

## 4. ProcessList render: floor + ceiling + ordering

- [ ] 4.1 In `packages/client/src/components/ProcessList.tsx`, add a `MIN_SLOTS = 5` constant and a `MAX_VISIBLE = 5` constant at module scope.
- [ ] 4.2 Before rendering, sort the incoming `processes` array by `elapsedMs` descending (do not mutate the prop — work on a local copy).
- [ ] 4.3 Compute `visible = sorted.slice(0, MAX_VISIBLE)`, `overflow = sorted.slice(MAX_VISIBLE)`, `skeletonCount = Math.max(0, MIN_SLOTS - visible.length) when overflow.length === 0 else 0`.
- [ ] 4.4 Render `visible` (existing row chrome). Then render `skeletonCount` skeleton rows (same row structure, `aria-hidden="true"`, no text/icon/button, `key={"skeleton-" + i}`). Then, if `overflow.length > 0`, render a single overflow row with text `+{overflow.length} more processes` and `title={overflow.map(p => p.command).join("\n")}`.
- [ ] 4.5 Apply identical floor/ceiling/ordering logic to both the `compact` branch and the full branch. Extract a small helper `computeVisibleRows(processes)` if duplication exceeds ~10 lines.
- [ ] 4.6 Visual check (manual): in dev mode, force `processes` to lengths 0, 1, 3, 5, 6, 9 via React DevTools or a test fixture — confirm footer height is stable from 1..N and the overflow row appears at length 6.

## 5. Tests

- [ ] 5.1 `packages/extension/src/__tests__/process-scanner.test.ts` (or existing test file) — add cases for D2 (excluded PGID refused at capture), D2 (excluded PGID dead-reap), and the filter-time defense-in-depth skip.
- [ ] 5.2 `packages/client/src/components/__tests__/ProcessList.test.tsx` — add cases for: returns null at 0; renders 1 real + 4 skeleton at len=1; renders 5 real + no overflow at len=5; renders 5 real + overflow row at len=6; orders by elapsedMs desc; overflow `title` lists hidden commands.
- [ ] 5.3 Run `npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures before committing.

## 6. Build & sanity-check

- [ ] 6.1 `npm run build` to confirm TypeScript compiles cleanly across packages.
- [ ] 6.2 Restart server (`curl -X POST http://localhost:8000/api/restart`) and run `npm run reload` to pick up bridge changes.
- [ ] 6.3 Visually verify in dev dashboard: open a session, run a long bash command (e.g. `sleep 30`), confirm it appears within ~5 s, kill it via the ✕, confirm it disappears. Confirm the dashboard's own `node` (server) does NOT appear in the list.
- [ ] 6.4 Cross-check on Windows (if available) that scan tick remains 10 s and min-elapsed remains 30 s — no regression to Windows users.

## 7. Documentation

- [ ] 7.1 Update `docs/file-index-extension.md` row for `process-scanner.ts` to mention `excludedPgids`. Caveman style. Delegate to a subagent per AGENTS.md docs-write rule.
- [ ] 7.2 Update `docs/file-index-extension.md` row for `bridge.ts` to mention platform-aware scan cadence. Caveman style. Delegate.
- [ ] 7.3 Update `docs/file-index-client.md` row for `ProcessList.tsx` to mention floor-5 / overflow tail. Caveman style. Delegate.
- [ ] 7.4 No AGENTS.md update needed (no new top-level area, no new architectural backbone file).
