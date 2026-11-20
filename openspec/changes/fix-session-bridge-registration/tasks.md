## 1. #1175 — release bridge ownership on session replacement (extension)

- [ ] 1.1 Test first in `packages/extension/src/__tests__/terminal-reload.test.ts`: `releaseBridgeOwnerOnShutdown` for `reload|new|resume|fork` → `isBridgeReentry(prev, P2)` is false; for `quit` → still true (keep E7b); a different pi with no shutdown → true. Confirm they fail for `resume|new|fork`.
- [ ] 1.2 Change `releaseBridgeOwnerOnShutdown` (`terminal-reload.ts:296`) to release for the four replacement reasons; update the doc comments there and at `bridge.ts:175`.
- [ ] 1.3 Test the replacement instance's `handleSessionChange` unregister of the already-unregistered outgoing id is a server no-op (`packages/server` gateway test); adjust only if it is not.
- [ ] 1.4 Test (bridge wiring): `session_shutdown{resume}` → new `initBridge(pi2)` runs and sends `session_register` for the new session id.

## 2. #1127 — send buffer keeps control frames (extension)

- [ ] 2.1 Tests first in `packages/extension/src/__tests__/connection-dropped-frames.test.ts`: register + overflow flood → register is first frame on flush; order of retained frames preserved with interleaved control frames; control cap 256; per-type counts in the warning; eviction stays O(1) amortised (10 000-frame flood completes under a generous time bound).
- [ ] 2.2 Implement in `connection.ts`: `PINNED_FRAME_TYPES`, two FIFO queues with monotonic sequence, evict from non-control only, control cap 256, merge by sequence on flush (`:1105-1109`); keep `getDroppedBufferedCount()` semantics.
- [ ] 2.3 Per-type drop counts in the overflow warning (`:734-740`), reset on flush; update existing assertions in `connection-dropped-frames.test.ts`.
- [ ] 2.4 Update `connection.ts` doc comment at `:607-612`; add a row/note to `packages/extension/AGENTS.md` if the per-file map requires it (main agent, not `docs/`).

## 3. #1128 — honest watchdog wording and evidence (server, shared, client)

- [ ] 3.1 Tests first in the watchdog test: fire with reclaim killing pid 4242 → message + failure entry carry `terminated: true`, `terminatedPids: [4242]`; no target → omitted; kill throws → still emitted.
- [ ] 3.2 `_reclaimSpawn` returns the signalled pids; `_fireEntry` adds `terminated`/`terminatedPids` to the `appendSpawnFailure` record and the message; extend `SpawnFailureEntry` (`spawn-failure-log.ts`) and `SpawnRegisterTimeoutMessage` (`shared/src/browser-protocol.ts:545`) with optional fields.
- [ ] 3.3 Client test first: `useMessageHandler` keeps `terminated` in the timeout detail; `SpawnErrorBanner` renders "…within {secs}s and was terminated." with and without PID, unchanged without the flag. Implement (`useMessageHandler.ts:1629`, `SpawnErrorBanner.tsx:119-120`, new i18n keys `err.spawnTimeoutTerminated*`).
- [ ] 3.4 Settings hint: new key `settings.spawnRegisterTimeoutHint` with the terminating wording in `i18n-en-source.json`, `i18n-hu.ts`, `i18n-zh-CN.ts`; use it at `SettingsPanel.tsx:2330`; remove the orphaned `common.howLongToWaitForA` and its alias if unused; update `settings-bespoke-validation.test.tsx` / `settings-field-contract.test.tsx` expectations.

## 4. Verify and ship

- [ ] 4.1 Run `npm test` per AGENTS.md (pipe to `/tmp/pi-test.log`, grep the summary); run `npm run quality:changed`.
- [ ] 4.2 `npm run reload` (extension), `npx tsx .pi/skills/implement/scripts/restart-server.ts` (server/shared), `npm run build` + restart (client).
- [ ] 4.3 Manual: `/resume` and `/new` in a dashboard-registered TUI session → the replacement appears in the dashboard; resume a large (>10 000-frame) session from the UI → registers; force a register timeout → banner and `spawn-failures.log` say terminated.
- [ ] 4.4 `review-code` pass; `doubt-driven-review` on the widened re-entry release.
- [ ] 4.5 `npx openspec validate fix-session-bridge-registration --strict` and `node scripts/check-conventions.mjs`.
