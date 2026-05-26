## 1. Pure helper

- [x] 1.1 Create `packages/electron/src/lib/pick-node.ts` exporting `pickNodeForServer(input)` and the `PickNodeInput` / `PickNodeResult` types per design D1.
- [x] 1.2 Implement the three branches in priority order: bundled → system (gated by `isKnownBadNode === false`) → `execpath-fallback` with `needsElectronRunAsNode: true`.
- [x] 1.3 Verify the executable check uses `existsSync` + `accessSync(..., X_OK)` (or the equivalent platform-safe helper already in `bundled-node.ts`); reuse, don't duplicate.

## 2. Unit tests for picker

- [x] 2.1 Create `packages/electron/src/lib/__tests__/pick-node.test.ts`.
- [x] 2.2 Cover: bundled present (POSIX + Windows path shapes); bundled missing + system safe; bundled missing + system known-bad → fallback; both missing → fallback.
- [x] 2.3 Assert `needsElectronRunAsNode === true` only on the fallback branch.
- [x] 2.4 All filesystem + platform inputs SHALL be injected through `PickNodeInput` so tests stay pure (no real fs calls).

## 3. V2 wiring — `spawnFromSource`

- [x] 3.1 In `packages/electron/src/lib/launch-source.ts`, import `pickNodeForServer`, `getBundledNodeDir` (add helper if not present in `bundled-node.ts`), `detectSystemNode`.
- [x] 3.2 Before the `launchDashboardServer({...})` call, compute `const pick = pickNodeForServer({ bundledNodeDir, systemNode, processExecPath: process.execPath, platform: process.platform })`.
- [x] 3.3 Pass `nodeBin: pick.nodeBin` into the `launchDashboardServer` options.
- [x] 3.4 If `pick.kind === "execpath-fallback"` → set `env.ELECTRON_RUN_AS_NODE = "1"` AND emit a warn-level log via `electron-log` (or `console.warn` if log lib is not wired) identifying the fallback.
- [x] 3.5 Confirm the existing `DASHBOARD_STARTER = "Electron"` stamp is preserved.

## 4. V1 wiring — `launchServer`

- [x] 4.1 In `packages/electron/src/lib/server-lifecycle.ts`, apply the same `pickNodeForServer` + `nodeBin` + conditional `ELECTRON_RUN_AS_NODE` treatment in the legacy `launchServer` function.
- [x] 4.2 Update the synthetic `errorArgv` in `launchServer`'s catch block to use `pick.nodeBin` (not the literal `"node"`) so the user-visible error message reflects what actually ran.

## 5. Repo-lint

- [x] 5.1 Create `packages/shared/src/__tests__/no-electron-execpath-spawn.test.ts`.
- [x] 5.2 The test SHALL parse every `packages/electron/src/lib/**/*.ts` (excluding `__tests__`) and detect call expressions whose callee identifier is `launchDashboardServer`.
- [x] 5.3 For each such call, assert the options literal contains either `nodeBin:` OR a visible `ELECTRON_RUN_AS_NODE` key in the merged env.
- [x] 5.4 Add an allowlist scan: only `pick-node.ts` MAY reference `process.execPath` as a node binary (pattern-matched; `processExecPath:` injection allowed elsewhere).
- [x] 5.5 Fail with a message describing the missing `nodeBin` and pointing at design D4.

## 6. ToolResolver env-strip audit

- [x] 6.1 Read `packages/shared/src/platform/binary-lookup.ts:buildSpawnEnv` and confirm `ELECTRON_RUN_AS_NODE` is filtered when the env is rebuilt for downstream `pi`-process spawns.
- [x] 6.2 If filtering is absent, add it (whitelist-strip the Electron-internal vars) AND extend `binary-lookup.test.ts` with one assertion. If already filtered, add a single assertion test to lock the behaviour.

## 7. Existing-test updates

- [x] 7.1 Update `packages/electron/src/lib/__tests__/launch-source.test.ts` (or its V2 counterpart) so the `spawnFromSource` invocation assertions verify `nodeBin` is supplied with a value matching `pick.nodeBin`.
- [x] 7.2 Update any `server-lifecycle.test.ts` fixture similarly for the V1 path.
- [x] 7.3 Adjust the existing `electron-launch-source` spec test (if any) that pins the old "argv starts with `process.execPath`" scenario — the modified spec now uses `<resolved-node-bin>`.

## 8. Manual QA

- [~] 8.1 Deferred to next release-cut QA. Cold-boot Mac: double-click app → connected UI within 15s.
- [~] 8.2 Deferred to next release-cut QA. Inspect `~/.pi/dashboard/server.log` for post-banner output.
- [~] 8.3 Deferred to next release-cut QA. Verify spawned child is `<app>/Contents/Resources/node/bin/node`.
- [~] 8.4 Deferred to next release-cut QA. Rename bundled Node, confirm system-Node fallback path.
- [~] 8.5 Deferred to next release-cut QA. Restore the bundled Node when done.

## 9. Docs

- [x] 9.1 Append a row to `docs/file-index-electron.md` for `packages/electron/src/lib/pick-node.ts` (caveman style, path-alphabetical).
- [x] 9.2 Add a new FAQ entry to `docs/faq.md` keyed on "silent server-start failure / launcher banner only" → answer pointing at this change. Delegate the `docs/` write to a general-purpose subagent per AGENTS.md Documentation Update Protocol.

## 10. Validate

- [x] 10.1 `openspec validate fix-electron-server-launch-node-bin --strict` passes.
- [x] 10.2 `npm test` green (vitest), with the new picker + lint tests included (12 pre-existing failures unrelated to this change; 0 new failures introduced).
- [~] 10.3 Deferred to next release-cut. `npm run electron:build` produces a Mac DMG that boots through the manual QA in §8.
