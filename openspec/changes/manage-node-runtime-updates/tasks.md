## 1. Pure helpers

- [ ] 1.1 Add `classifyNodeSource(nodePath)` to `packages/shared/src/platform/classify-node-source.ts`. Pure function returning `"managed" | "system" | "bundled-electron"`. Compares `realpathSync(nodePath)` against `<managedDir>/node/` and `process.resourcesPath/node/`. Treats unresolvable paths as `"system"`. Foundation `embed-managed-node-runtime` (archived) supplies the managed dir — this task builds the classifier on top.
- [ ] 1.2 Unit-test `classifyNodeSource` table-driven against memfs paths: managed, system, bundled-electron, symlink-resolves-into-managed, unresolvable-path → system

## 2. Node runtime checker

- [ ] 2.1 Add `packages/server/src/node-runtime-checker.ts` mirroring `pi-core-checker.ts`. Public `getStatus({ refresh })` returns `{ source, currentVersion, latestVersion, updateAvailable, lastChecked }`. 24h in-memory cache, persisted to `~/.pi/dashboard/node-runtime-cache.json`
- [ ] 2.2 Implement `fetchLatestLts(currentMajor)` hitting `https://nodejs.org/dist/index.json`, filtering `lts !== false`, returning the newest within-major version. Failures logged, return null, never throw
- [ ] 2.3 Unit-test `node-runtime-checker.ts`: cache hit within 24h skips fetch, force-refresh bypasses cache, fetch failure returns `latestVersion: null` without throwing, within-major filtering correct

## 3. Node runtime updater

- [ ] 3.1 Add `packages/server/src/node-runtime-updater.ts` mirroring `pi-core-updater.ts`. Public `update({ allowMajor })`. Routes by `classifyNodeSource`: managed → stage; system / bundled-electron → reject with typed error
- [ ] 3.2 Implement download to `<managedDir>/node-pending/`. Per-OS URL construction from nodejs.org/dist (zip on Windows, tar.xz on Unix). Progress emitted via shared `pi_core_update_progress` channel with `name: "node"` and `phase: "download"`
- [ ] 3.3 Implement SHA-256 verification: fetch `SHASUMS256.txt` from same release dir, compute digest of downloaded archive, abort + clean up if mismatch
- [ ] 3.4 Implement post-extract `--version` verification: invoke staged `node-pending/{node.exe|bin/node} --version`, compare to expected. Abort + clean up on mismatch
- [ ] 3.5 Implement marker write: `<managedDir>/.node-swap-pending` containing the staged version string. Only on full success
- [ ] 3.6 Implement major-version gate: reject with typed `NodeRuntimeMajorVersionGate` when latest crosses major and `allowMajor !== true`
- [ ] 3.7 Wire `runExclusive` from `PackageManagerWrapper` so update shares the busy-lock with `pi-core-updater`
- [ ] 3.8 Define typed errors: `NodeRuntimeUpdateNotApplicable(source)`, `NodeRuntimeMajorVersionGate(currentMajor, latestMajor)`, `NodeRuntimeStagedVerificationFailed(reason)`, `NodeRuntimeShaMismatch(expected, actual)`
- [ ] 3.9 Unit-test the updater with all source types (managed proceeds, system rejects, bundled-electron rejects), major-version-gate behavior in both directions, SHA-mismatch aborts, version-verification mismatch aborts, marker-not-written-on-failure invariant

## 4. Swap-on-start helper

- [ ] 4.1 Add `packages/electron/src/lib/node-runtime-swap.ts` exporting `applyPendingSwap(managedDir)` and `cleanupOldNode(managedDir)`. Pure of network, side-effects bounded to renames + delete
- [ ] 4.2 `applyPendingSwap`: if `.node-swap-pending` marker exists, atomic rename `node` → `node-old`, `node-pending` → `node`, delete marker. Emit one log line per phase
- [ ] 4.3 `cleanupOldNode`: if `node-old` exists and no marker, delete `node-old`. No-op otherwise
- [ ] 4.4 Hook both into `packages/electron/src/main.ts` BEFORE the dashboard server is launched (sequencing matters — must happen while no process holds `node.exe`)
- [ ] 4.5 Hook both into `packages/server/src/cli.ts` BEFORE the HTTP server binds, so standalone CLI installs also benefit
- [ ] 4.6 Unit-test the helper against memfs: marker present → swap applied + marker cleared; node-old present, no marker → cleaned; nothing present → no-op; pending dir present, no marker → no swap (defensive)
- [ ] 4.7 Manual test on Windows: stage a swap, restart, confirm `node.exe` replaced and old version cleaned on next-next start

## 5. PiCoreChecker synthetic row

- [ ] 5.1 Edit `packages/server/src/pi-core-checker.ts::getStatus()` to inject the synthetic Node runtime entry from `node-runtime-checker.getStatus()`, mapping `classifyNodeSource` result to the source taxonomy: `managed → "managed"`, `system → "global"`, `bundled-electron → "bundled"`
- [ ] 5.2 Update `PiCorePackage` / `PiCoreStatus` types in `packages/shared/src/rest-api.ts` to allow `installSource: "global" | "managed" | "bundled"` (extend the existing union). Currently `"global" | "managed"` only.
- [ ] 5.3 Update `PiCoreChecker.getStatus()` to include the runtime row in the `updatesAvailable` count
- [ ] 5.4 Extend `packages/server/src/__tests__/pi-core-checker.test.ts` to assert the synthetic row is present, source mapping is correct for each of the three classify outputs, and the count includes the runtime when `updateAvailable: true`

## 6. REST surface

- [ ] 6.1 Add `POST /api/pi-core/update-node` to `packages/server/src/routes/pi-core-routes.ts`. Body: `{ allowMajor?: boolean }`. Responses: 202 `{ ticketId }`, 409 (lock contention), 400 (non-managed source)
- [ ] 6.2 Wire the route to `node-runtime-updater.update()` through the same `runExclusive` lock used by the existing `update` route
- [ ] 6.3 Test `pi-core-routes.test.ts`: 202 on managed/idle, 409 on contention, 400 on system, 400 on bundled-electron, body validation rejects extra fields

## 7. Frontend wire-up

The section previously known as `PiCoreVersionsSection` was renamed to `UnifiedPackagesSection` under change: consolidate-packages-settings-ui. All references below use the current name.

- [ ] 7.1 Update `packages/client/src/components/UnifiedPackagesSection.tsx` to render the synthetic Node runtime row using the existing `PackageRow` component. Source-specific badge values (`local` / `global` / `bundled`)
- [ ] 7.2 Implement disabled-Update-button states with tooltips for `system` and `bundled` sources
- [ ] 7.3 Implement cross-major confirmation dialog. Triggered when `latestVersion` major ≠ `currentVersion` major. On confirm, POST `{ allowMajor: true }`
- [ ] 7.4 Implement swap-pending state: on `pi_core_update_complete` with `name: "node"` and `swapPending: true`, replace Update button with "Restart to apply" indicator + "Restart now" button (POSTs `/api/restart`)
- [ ] 7.5 Update `packages/client/src/components/PiUpdateBadge.tsx` to include the runtime in the count regardless of source (badge counts informational updates, source-disabled rows still bump the count)
- [ ] 7.6 Wire `pi_core_update_progress` events with `phase: "download"` to a download-progress affordance on the row (re-uses existing progress UI)
- [ ] 7.7 Component test for `UnifiedPackagesSection` covering: managed enables button, system disables with tooltip, bundled disables with tooltip, swap-pending shows Restart, cross-major shows dialog, within-major skips dialog

## 8. Doctor integration

- [ ] 8.1 Edit `packages/electron/src/lib/doctor.ts` to surface the runtime row's source, current version, and swap-pending state
- [ ] 8.2 Doctor SHALL detect and clean up stale `node-old/` (extends Decision 8 backstop)
- [ ] 8.3 Doctor test asserting stale-node-old cleanup and runtime-row reporting

## 9. Docs and cross-references

- [ ] 9.1 Delegate to a general-purpose subagent: add a row for `node-runtime-checker.ts` to `docs/file-index-server.md` in caveman style, in path-alphabetical order
- [ ] 9.2 Delegate to a general-purpose subagent: add a row for `node-runtime-updater.ts` to `docs/file-index-server.md` in caveman style
- [ ] 9.3 Delegate to a general-purpose subagent: add a row for `node-runtime-swap.ts` to `docs/file-index-electron.md` in caveman style
- [ ] 9.4 Delegate to a general-purpose subagent: add a row for `classify-node-source.ts` to `docs/file-index-shared.md` in caveman style
- [ ] 9.5 Delegate to a general-purpose subagent: extend `docs/architecture.md` Pi Ecosystem section with a one-paragraph caveman-style note explaining source-aware Node updates, stage-and-swap, and the cross-major gate
- [ ] 9.6 Delegate to a general-purpose subagent: append `docs/faq.md` entries: "How do I update the managed Node runtime?", "Why is the Node Update button disabled?", "How do I roll back a failed Node update?"

## 10. Manual verification

- [ ] 10.1 Windows: trigger update from Settings, confirm download progress streams, confirm "Restart to apply" appears, restart, confirm new Node version active, confirm `node-old` cleaned on next-next start
- [ ] 10.2 Windows: disconnect network mid-download, confirm clean rollback (no marker, no half-extracted `node-pending/`)
- [ ] 10.3 Windows: corrupt the downloaded archive (intercept), confirm SHA mismatch aborts cleanly
- [ ] 10.4 macOS: same flow as 10.1, on a managed install
- [ ] 10.5 Linux: same flow as 10.1, on a managed install
- [ ] 10.6 System Node host: confirm runtime row badge says `global`, Update button disabled with correct tooltip
- [ ] 10.7 Bundled-Electron Node host (no managed copy): confirm runtime row badge says `bundled`, Update button disabled with correct tooltip
- [ ] 10.8 Cross-major: when within-major LTS is current but a higher-major LTS exists, click Update, confirm confirmation dialog, accept, confirm flow proceeds with `{ allowMajor: true }`
