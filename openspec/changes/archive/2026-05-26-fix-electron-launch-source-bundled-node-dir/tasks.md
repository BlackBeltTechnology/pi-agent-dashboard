# Tasks

## 1. Fix the call site

- [x] 1.1 In `packages/electron/src/lib/launch-source.ts`, change the import from `bundled-node.js` to bring `getBundledNodeDir` (drop `getBundledNodePath`).
- [x] 1.2 In `spawnFromSource`, replace:
  ```ts
  const bundledNode = getBundledNodePath();
  const bundledNodeDir = bundledNode ? path.dirname(path.dirname(bundledNode)) : null;
  ```
  with:
  ```ts
  const bundledNodeDir = getBundledNodeDir();
  ```

## 2. Unit test — Windows-shape resources tree

- [x] 2.1 In `packages/electron/src/lib/__tests__/pick-node.test.ts`, add a test that calls `pickNodeForServer({ bundledNodeDir: "C:\\res\\node", processExecPath: "C:\\app\\pi-dashboard.exe", platform: "win32", existsSync: (p) => p === "C:\\res\\node\\node.exe" })` and asserts `{ kind: "bundled", nodeBin: "C:\\res\\node\\node.exe" }`.
  - Reason: prove the contract `launch-source` relies on — when given the correct `bundledNodeDir` on win32, `pickNodeForServer` finds `node.exe`.
- [x] 2.2 Negative companion test: same call but with `bundledNodeDir: "C:\\res"` (the dirname-dirname bug shape) and the same `existsSync` — asserts `{ kind: "execpath-fallback" }`. Documents the precise input shape that produced the regression so any future refactor of `launch-source.ts` cannot silently regress.

## 3. Repo-lint — forbid dirname-arithmetic on getBundledNodePath

- [x] 3.1 Create `packages/electron/src/__tests__/no-dirname-chain-on-bundled-node-path.test.ts`. Scan every `.ts` under `packages/electron/src/` (excluding `__tests__/`). Fail if any file contains a regex match for `path\.dirname\([^)]*path\.dirname\([^)]*getBundledNodePath` (whitespace-tolerant).
- [x] 3.2 The failure message SHALL include:
  - the offending file path,
  - the offending line content,
  - the directive: "Use `getBundledNodeDir()` from bundled-node.ts instead. Windows layout is one segment shallower than POSIX."

## 4. Validate

- [x] 4.1 `npm test` — all green. (Root run: 5974 passed. Electron package run: 8 of my new tests pass; 5 pre-existing orphaned failures unrelated to this change — see vitest.config.ts comment explaining the exclusion.)
- [x] 4.2 Build the bundle: `node packages/electron/scripts/bundle-server.mjs`. (Sanity — no expected behavioural change in the bundle output.)
- [x] 4.3 Push to `feat/enable-standalone-npm-install`. Dispatch `ci-electron.yml legs: win32-x64`. Smoke on the Windows VM: (CI run 26426824035 succeeded; user confirmed pi spawn now works on the resulting artifact.)
  - Server log (`%USERPROFILE%\.pi\dashboard\server.log`) SHALL NOT contain "Bundled Node not found — falling back".
  - Server process command line SHALL be `<install>\resources\node\node.exe …` (visible via Task Manager → Details → Command line or via `wmic process where name="node.exe" get CommandLine`).
  - `ELECTRON_RUN_AS_NODE` env var SHALL be absent from the server's environment (visible via Process Explorer).
- [x] 4.4 With the windows-path fix landed (this branch also has `fix-windows-path-system32-missing`), run the wizard, then spawn pi from the dashboard UI. Verify task 7.6 of `fix-windows-path-system32-missing` now passes meaningfully. (Confirmed: "spawn works".)

## 5. Docs

- [x] 5.1 Delegate to a general-purpose subagent: update `docs/file-index-electron.md` row for `packages/electron/src/lib/launch-source.ts` to note "uses getBundledNodeDir(); never dirname-chain on bundled-node path. See change: fix-electron-launch-source-bundled-node-dir." per the Documentation Update Protocol (caveman style).
- [x] 5.2 Same subagent: add a one-line pointer in `docs/file-index-electron.md` (or wherever lint tests are catalogued) for the new lint test file.
