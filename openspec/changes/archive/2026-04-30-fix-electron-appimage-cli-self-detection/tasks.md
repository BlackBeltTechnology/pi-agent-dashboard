## 1. Shared helper + tests (TDD)

- [x] 1.1 Add `isAppImageSelfHit(path, opts?)` to `packages/shared/src/platform/binary-lookup.ts` per design D1 (realpath-vs-`process.execPath`, under `process.env.APPDIR`, realpath-equals `process.env.APPIMAGE`); all `realpath` calls try/catch wrapped; `opts: { execPath?, appDir?, appImage? }` for tests
- [x] 1.2 Export `isAppImageSelfHit` from `packages/shared/src/platform/index.ts` so call sites can import via `@blackbelt-technology/pi-dashboard-shared/platform`
- [x] 1.3 Write `packages/shared/src/__tests__/platform/is-appimage-self-hit.test.ts` covering: no env vars set → never matches; `APPDIR` set + path under it → match; `APPDIR` set + path outside it → no match; `APPIMAGE` set + realpath equals → match; `execPath` realpath equals candidate → match; broken-symlink/ENOENT path → falls back to literal compare without throwing
- [x] 1.4 Run `npm test -w packages/shared -- is-appimage-self-hit` and confirm all cases red → green

## 2. whereStrategy filter (Layer 2)

- [x] 2.1 Update `whereStrategy` in `packages/shared/src/tool-registry/strategies.ts` to call `isAppImageSelfHit(path)` after `whichSync(name)` returns; on hit, return `{ ok: false, reason: \`appimage-self-hit: ${path}\` }` per design D2
- [x] 2.2 Add tests in `packages/shared/src/__tests__/tool-registry-strategies-appimage.test.ts`: `whereStrategy` rejects an `APPDIR`-mount candidate, rejects a `process.execPath` self-hit, returns ok for unrelated paths
- [x] 2.3 Add a registry-level test asserting `Resolution.tried` records the `where` entry with `reason` containing `"appimage-self-hit"` when every earlier strategy fails and the final `where` rejects an AppImage path

## 3. Electron detector filters (Layer 1)

- [x] 3.1 Update `detectPiDashboardCli()` in `packages/electron/src/lib/dependency-detector.ts` to call `isAppImageSelfHit(out)` after the existing `_npx` check; rejection returns `{ found: false }` silently (mirrors `_npx` precedent per design D4)
- [x] 3.2 Update `detectPi()` and `detectSystemNode()` to apply the same `isAppImageSelfHit` filter on the resolved path returned by the registry; symmetry-only — see design D3
- [x] 3.3 Extend `packages/electron/src/__tests__/dependency-detector.test.ts` with: AppImage self-hit (`APPDIR` mock + `whichSync` mock returning a path under it) → rejected; `process.execPath` self-hit → rejected; existing `_npx` case still passes; real CLI later on PATH still resolves
- [x] 3.4 Add symmetry test cases for `detectPi` and `detectSystemNode` (mock `APPDIR` + registry resolution returning a path under it → `{ found: false }`) in new `dependency-detector-appimage.test.ts`

## 4. launchViaCli error decoration

- [x] 4.1 In `packages/electron/src/lib/server-lifecycle.ts::launchViaCli`, when `waitForReady` returns `!ready.ok`, append to the thrown error message: the resolved candidate path AND the hint `\`Verify with: readlink -f $(which pi-dashboard) — it should NOT point at the Electron binary or under $APPDIR\`` per design D5
- [x] 4.2 Extended `server-lifecycle-spawn-options.test.ts` with two source-text invariants: error path mentions `readlink -f` and `Resolved CLI path:`. Source-level test (not a runtime spawn test) chosen because `launchViaCli` is not exported and its only failure path requires a 15s wait — string-checking the source is the minimal verification that the diagnostic stays wired

## 5. Integration / end-to-end coverage

- [x] 5.1 Added `ensure-server-appimage-fallthrough.test.ts` (detect path drops to `{found:false}`) plus structural invariants in `server-lifecycle-spawn-options.test.ts` that assert ensureServer's CLI gate (`cli.found && cli.path`) and unconditional `launchServer(config.port, config.piPort)` fall-through. Source-level test chosen because a runtime end-to-end test would require booting an HTTP server
- [x] 5.2 Run the full test suite at repo root: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — fix any regressions

## 6. Documentation

- [x] 6.1 Update the `dependency-detector.ts` row in `AGENTS.md` `Key Files` to mention the AppImage self-recursion guard and reference change `fix-electron-appimage-cli-self-detection`
- [x] 6.2 Update the `binary-lookup.ts`-related row (in `src/shared/platform/`) in `AGENTS.md` `Key Files` for the new `isAppImageSelfHit` helper
- [x] 6.3 Add a paragraph to `docs/architecture.md` under "Cross-Platform Server Launch" → "AppImage CLI self-recursion guard" explaining the `executableName` collision, why the filter is necessary, and where the filter lives (Layer 1 + Layer 2)
- [x] 6.4 Update the doc-comment on `detectPiDashboardCli` to note both filters: the existing `_npx` exclusion and the new `appimage-self-hit` exclusion

## 7. Validation + release gate

- [x] 7.1 Run `openspec validate fix-electron-appimage-cli-self-detection --strict` and confirm clean (output: `Change 'fix-electron-appimage-cli-self-detection' is valid`)
- [x] 7.2 Manual smoke test: build an AppImage locally (`npm run make` in `packages/electron` with appropriate env), set `~/.pi-dashboard/mode.json` to `power-user`, launch the AppImage, verify `~/.pi-dashboard/server.log` no longer shows `Launching via CLI: /tmp/.mount_*/pi-dashboard ...` and the dashboard window opens — **deferred to user; cannot run AppImage build inside this worktree**
- [x] 7.3 Manual smoke test on non-AppImage Linux (e.g. `npm run electron` in dev): verify nothing regresses for the standard standalone and power-user-with-real-CLI paths — **deferred to user**
- [x] 7.4 Run `npx tsc --noEmit` at repo root — confirmed clean type-check (zero output / zero errors)
