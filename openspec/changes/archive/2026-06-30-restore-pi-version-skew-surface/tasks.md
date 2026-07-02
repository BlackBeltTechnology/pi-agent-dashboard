## 1. Compatibility primitive — error state

- [x] 1.1 `packages/server/src/pi-version-skew.ts`: add `error?: string` to the `BootstrapCompatibility` interface (doc comment: "Set when `current < minimum`; names both versions.").
- [x] 1.2 `computeCompatibility`: when `current` is below `minimum`, populate `error` with a non-empty string containing both the running version and the required `minimum` (keep `upgradeRecommended: true`).
- [x] 1.3 Tests in `packages/server/src/__tests__/pi-version-skew.test.ts`: assert `error` set + contains both versions when below minimum; absent when at/above minimum; absent when `current` undefined.

## 2. Server surface — /api/health.compatibility

- [x] 2.1 `packages/server/src/routes/system-routes.ts`: add `compatibility: BootstrapCompatibility | null` to the `/api/health` response, computed via `readPiCompatibility(serverPkgJsonPath) + readCurrentPiVersion() + computeCompatibility()`. `null` when `readCurrentPiVersion()` returns `undefined`.
- [x] 2.2 Wrap the compute in a 30s in-module cache (timestamp + last value) so repeated health polls call `readCurrentPiVersion()` at most once per 30s window.
- [x] 2.3 Confirm the field never throws the handler to 500 (wrap in try/catch → `null` on failure, matching the existing health-handler resilience).
- [x] 2.4 Test `packages/server/src/__tests__/health-compatibility.test.ts` — three fixtures: pi-matches-recommended (no flags), pi-below-recommended (`upgradeRecommended`), pi-below-minimum (`error`); plus pi-unresolvable → `null`; plus cache: two calls within 30s → `readCurrentPiVersion` invoked once.

## 3. Client surface — global advisory

- [x] 3.1 `packages/client/src/hooks/usePiCompatibility.ts`: fetch `/api/health` on mount, refetch every 60s, clean up interval on unmount; expose `.compatibility` reactively.
- [x] 3.2 `packages/client/src/components/PiVersionAdvisory.tsx`: render nothing when `compatibility` is `null` OR (`error` absent AND `upgradeRecommended` falsy); yellow soft pill when `upgradeRecommended` (show `current` + `recommended`); red panel + "How to upgrade" disclosure (with `npm install -g @earendil-works/pi-coding-agent@<recommended>`) when `error` set.
- [x] 3.3 Mount `PiVersionAdvisory` at the top of Settings → General (`SettingsPanel`).
- [x] 3.4 Test `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx`: render per state (hidden / soft / hard).

## 4. Protocol + types — per-session version

- [x] 4.1 `packages/shared/src/protocol.ts`: add `interface PiVersionUpdateMessage { type: "pi_version_update"; sessionId: string; version: string }` (mirror `GitInfoUpdateMessage`); add to `ExtensionToServerMessage` union.
- [x] 4.2 `packages/shared/src/types.ts`: add `piVersion?: string` to `DashboardSession`.
- [x] 4.3 Round-trip JSON test (`packages/shared/src/__tests__/pi-version-update-protocol.test.ts`).

## 5. Bridge — push per-session version

- [x] 5.1 `packages/extension/src/model-tracker.ts`: add module-scoped `lastPiVersion` + `sendPiVersionIfChanged(bc)` mirroring `sendGitInfoIfChanged`. Read `@earendil-works/pi-coding-agent/package.json` via `createRequire(import.meta.url).resolve(...)` + `fs.readFileSync`; on read failure log a warning and return; send only on first read and on change.
- [x] 5.2 `packages/extension/src/bridge.ts`: call `sendPiVersionIfChanged` once in the `session_register` flow.
- [x] 5.3 `packages/extension/src/bridge.ts`: call `sendPiVersionIfChanged` on the existing git/model poll tick (30s `runGitPollTick`; no new timer).
- [x] 5.4 Test (`packages/extension/src/__tests__/pi-version-tracker.test.ts`): injected reader sequence — first call pushes once; same-value call pushes nothing; changed-value call pushes once; throwing reader → no crash, no push.

## 6. Server — store + broadcast per-session version

- [x] 6.1 `packages/server/src/event-wiring.ts`: add a `pi_version_update` arm next to `git_info_update` — `sessionManager.update(sessionId, { piVersion: msg.version })` + `browserGateway.broadcastSessionUpdated(sessionId, { piVersion: msg.version })`.
- [x] 6.2 Test (`packages/server/src/__tests__/pi-version-update-handling.test.ts`): register + send message, assert `sessionManager.get(id).piVersion` stored.

## 7. Client — per-session label

- [x] 7.1 Render `session.piVersion` as a read-only label where git branch / model already render in the session header; hidden when `undefined`. No new component, no banner.

## 8. Verification

- [x] 8.1 `npm test`: new tests green; the 28 full-suite failures are pre-existing (17 `image-fit`/Jimp; rest heavy server-integration flakes that pass in isolation, e.g. `event-wiring-source-stamp` fails identically on `main`). Zero failures reference this change.
- [~] 8.2 `npm run build && curl /api/restart && npm run reload` — N/A in worktree (deploy step; per AGENTS.md not run for worktree-isolated work).
- [x] 8.3 `GET /api/health.compatibility` object on pi-resolvable host; `null` when unresolvable — covered by `health-compatibility.test.ts` (mocked `readCurrentPiVersion`).
- [x] 8.4 amber soft / red below-minimum advisory states — covered by `PiVersionAdvisory.test.tsx`.
- [~] 8.5 Live out-of-band session-header smoke — manual; deferred to deploy (logic covered by `pi-version-tracker.test.ts` + `pi-version-update-handling.test.ts`).

## 9. Documentation

- [x] 9.1 CHANGELOG `[Unreleased] / ### Added`: global advisory ("Settings → General now warns when the dashboard's pi is below the recommended/minimum floor") + per-session label ("each session shows the pi version it actually runs, reported live by the bridge; out-of-band upgrades reflect within ~60s").
- [x] 9.2 `docs/file-index-server.md`: re-annotate `pi-version-skew.ts` (drop dead-code implication; add `error` field), `system-routes.ts` (`/api/health.compatibility`), `event-wiring.ts` (`pi_version_update` arm).
- [x] 9.3 `docs/file-index-client.md`: add rows for `PiVersionAdvisory.tsx` + `usePiCompatibility.ts`; note the session-header `piVersion` label.
- [x] 9.4 `docs/file-index-extension.md`: `model-tracker.ts` (`sendPiVersionIfChanged`) + `bridge.ts` (call sites).
- [x] 9.5 `docs/file-index-shared.md`: `protocol.ts` (`PiVersionUpdateMessage`) + `types.ts` (`DashboardSession.piVersion`).
