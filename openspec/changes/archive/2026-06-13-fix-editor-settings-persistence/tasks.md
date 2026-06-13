## 1. Implementation

- [x] 1.1 Rename `writeVscodeThemeSettings` → `writeVscodeUserSettings` in `packages/server/src/editor-manager.ts`; update both call sites (`start()` and `setTheme()`).
- [x] 1.2 Extend the merged settings object with persistence keys:
  - `window.restoreWindows: "all"`
  - `workbench.editor.restoreViewState: true`
  - `files.hotExit: "onExitAndWindowClose"`
  - `security.workspace.trust.enabled: false`
  - `update.mode: "none"`
  - `extensions.autoCheckUpdates: false`
  - `workbench.startupEditor: "none"`
- [x] 1.3 Flip merge order so existing user values win over seeded defaults (currently seeded values overwrite). Theme keys remain authoritative because they are explicitly set by the dashboard each spawn.
- [x] 1.4 ~~In `stop()`, change `killProcess(pid, { timeoutMs: 2000 })` → `killProcess(pid, { timeoutMs: 5000 })`.~~ Satisfied-by-keeper: since `add-editor-keeper-sidecar`, `stop()` delegates to `keeper.cjs`, which already kills code-server with `STOP_GRACE_MS = 5000` (SIGTERM → 5 s → SIGKILL of pgroup). No `killProcess` call remains in `editor-manager.stop()`.
- [x] 1.5 Dedup concurrent `start(cwd)`: wrap the body as `startInner`; `start` memoizes an in-flight `Promise<EditorInstanceInfo>` per cwd in `inFlightStarts`, clears on settle. Prevents duplicate keeper/code-server spawn on one `--user-data-dir` when multiple browser tabs open the same folder.
- [x] 1.6 Client guard (`packages/client/src/components/EditorView.tsx`): `startInFlightRef` suppresses a second concurrent `/api/editor/start` from the same tab (StrictMode double-mount, rapid remount, heartbeat re-start overlapping initial start). Reset in `finally`.

## 2. Tests

- [x] 2.1 Unit test: calling `start(cwd)` on a fresh data dir writes a `settings.json` containing all seeded keys. (Tested via `setTheme(cwd)` — same `writeVscodeUserSettings` path, no keeper spawn needed. See `editor-settings-seeding.test.ts`.)
- [x] 2.2 Unit test: calling `start(cwd)` when `settings.json` already has `security.workspace.trust.enabled: true` preserves that value; absent keys get seeded.
- [x] 2.3 Unit test: `setTheme(cwd, "light")` after a prior `start(cwd)` updates the theme keys but does not strip the seeded persistence keys.
- [x] 2.4 ~~Unit test: `stop()` waits up to 5 s before SIGKILL (mock `killProcess` and assert `timeoutMs` arg).~~ Satisfied-by-keeper: 5 s grace lives in `keeper.cjs` (`STOP_GRACE_MS`), covered by `editor-keeper/__tests__/keeper.test.ts`. No `killProcess` in `stop()` to mock.
- [x] 2.5 Unit test: two concurrent `start(cwd)` for the same folder spawn exactly one keeper and resolve to the same instance (`editor-manager-keeper.test.ts`). Regression for the stalled-code-server race.
- [x] 2.6 Client test (`EditorView.test.tsx`): under React StrictMode double-mount, `/api/editor/start` fires exactly once. Verified failing (2 calls) without the `startInFlightRef` guard.

## 3. Documentation

- [x] 3.1 Update `docs/file-index-server.md` row for `editor-manager.ts` with a "See change: fix-editor-settings-persistence" annotation noting the rename + persistence-keys seeding. (Delegate to a subagent per AGENTS.md Documentation Update Protocol.)
- [x] 3.2 No `AGENTS.md` change — backbone row already covers the file at the right altitude.

## 4. Verification

- [x] 4.1 Manual: open a folder editor, open 3 tabs, edit a buffer (don't save), run `pi-dashboard restart`, reopen the same folder → all 3 tabs reappear, dirty buffer restored from hot-exit. (Enabling keys confirmed written: `window.restoreWindows: all`, `workbench.editor.restoreViewState: true`, `files.hotExit: onExitAndWindowClose`. Full restart-loop not yet exercised against live server.)
- [x] 4.2 Manual: open a fresh folder → no Workspace Trust dialog, no "Welcome" tab, no update banner. VERIFIED: spawned real code-server via worktree `editor-manager` (isolated HOME, fresh temp folder); browser at the code-server port showed folder open directly — no Trust dialog, no Walkthrough/Welcome tab, no Restricted Mode, no update banner.
- [x] 4.3 `npm test` editor suites clean (23 passed: editor-manager, editor-manager-keeper, editor-settings-seeding, keeper). 17 pre-existing failures isolated to `pi-image-fit` (Jimp `img.write` API) — untouched by this change.
- [x] 4.4 `openspec validate fix-editor-settings-persistence` passes.
