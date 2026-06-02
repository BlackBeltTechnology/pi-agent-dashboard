## 1. Bridge: exclude pi's own PGID

- [x] 1.1 Add `getOwnPgid()` helper (cached) to `packages/extension/src/process-scanner.ts` — `ps -o pgid= -p <process.pid>` on Unix, returns `undefined` on Windows / failure. Unit-test parse + cache + failure path.
- [x] 1.2 In `packages/extension/src/bridge.ts`, after the `onServerSpawned` wiring, resolve pi's own PGID once and `selfSpawnedPgids.add(ownPgid)` when defined.
- [x] 1.3 Add a bridge/scanner test: a child sharing pi's PGID is refused at capture and absent from scan output; a child with a different PGID survives.

## 2. Shared protocol: classification fields

- [x] 2.1 Extend the `process_list` per-process entry type (extension→server) in `packages/shared/src/browser-protocol.ts` with optional `kind`, `label`, `sessionRef`.
- [x] 2.2 Extend the `process_list_update` per-process entry type (server→browser) with the same fields; add the `ProcessKind` union type `"task" | "sub-session" | "pi-worker" | "plugin"`.
- [x] 2.3 Verify type-check passes across packages (`npm run reload:check` or `tsc`).

## 3. Server: process classifier (pure)

- [x] 3.1 Create `packages/server/src/process-classifier.ts` exporting `classifyProcesses(processes, pidIndex)` and a `buildPidIndex(sessions)` helper (`pid → { sessionId, name, model }`, connected sessions only).
- [x] 3.2 Implement command-pattern plugin-name extraction (`…/.pi/agent/**/<name>/<file>` → `<name>`) and the `pi` basename test.
- [x] 3.3 Unit tests in `packages/server/src/__tests__/process-classifier.test.ts`: sub-session (in index), pi-worker (not in index), plugin (context-mode path), task (fallback), non-destructive field preservation, pid-reuse guard (dead session not in index).

## 4. Server: wire classification into the forward path

- [x] 4.1 In `packages/server/src/event-wiring.ts` `process_list` handler, build the pidIndex from connected sessions, call `classifyProcesses`, store enriched entries on the session, and forward enriched entries in `process_list_update`.
- [x] 4.2 Route/integration test: a `process_list` containing a `pi` pid matching a connected session is forwarded with `kind: "sub-session"` + `sessionRef`; a `context-mode` bun entry is forwarded as `kind: "plugin"`.
- [x] 4.3 Confirm late subscribers receive enriched stored processes (replay path).

## 5. Client: render icon + label

- [x] 5.1 In `packages/client/src/components/ProcessList.tsx`, render the `kind` icon + `label` per row; fall back to raw `command` when fields absent.
- [x] 5.2 (DECISION 5) Make `sub-session` rows link to the referenced session card (`sessionRef` → focus/scroll). Implement only if the decision is YES.
- [x] 5.3 (DECISION 6) Choose icon source (emoji vs `mdi-icon-system`) and apply. — chose mdi (@mdi/js: mdiRobotOutline / mdiPowerPlugOutline / mdiCogOutline).
- [x] 5.4 Update/extend `ProcessList` tests for icon + label rendering and the backward-compatible fallback.

## 6. Verify + docs

- [x] 6.1 Full type-check + `npm test` green (sole failure: pre-existing flaky image-fit-extension timeout, fails on clean tree). for shared/extension/server/client.
- [x] 6.2 Manual check (requires running dashboard + reload — pending user verification): reload sessions (`npm run reload`), confirm the PROCESS drawer no longer lists pi / context-mode and that any real background task / subagent shows with icon + label.
- [x] 6.3 Add file-index rows for `packages/server/src/process-classifier.ts` (and any new helper) per the Documentation Update Protocol (delegate the `docs/` write).

## Open decisions to resolve before implementing

- [x] D4: headless `pi-worker` label — RESOLVED: generic `"pi worker"`.
- [x] D5: clickable `sub-session` rows — RESOLVED: yes, link to session card via `onNavigateToSession`.
- [x] D6: icon source — RESOLVED: `mdi-icon-system` (@mdi/js icons).
