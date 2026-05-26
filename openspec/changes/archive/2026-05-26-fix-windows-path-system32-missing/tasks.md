# Tasks

## 1. Shared helper

- [x] 1.1 Create `packages/shared/src/platform/ensure-windows-path.ts` exporting pure helper `ensureWindowsSystemPath(env: NodeJS.ProcessEnv, opts?: { platform?: NodeJS.Platform; exists?: (p: string) => boolean }): NodeJS.ProcessEnv`.
- [x] 1.2 Behaviour on `platform !== "win32"`: return `env` unchanged.
- [x] 1.3 Behaviour on `platform === "win32"`:
  - Read `SYSTEMROOT` from `env`, default to `C:\Windows` if absent.
  - Read `LOCALAPPDATA` from `env`, default to `C:\Users\<user>\AppData\Local` (skip if user can't be inferred — best-effort).
  - Build candidate-paths list (in order):
    ```
    %SYSTEMROOT%\System32
    %SYSTEMROOT%
    %SYSTEMROOT%\System32\Wbem
    %SYSTEMROOT%\System32\WindowsPowerShell\v1.0
    %SYSTEMROOT%\System32\OpenSSH
    %LOCALAPPDATA%\Microsoft\WindowsApps
    ```
  - For each candidate: if `exists(path)` AND path is NOT already substring-present in `env.PATH`, prepend to a `toAdd[]` list.
  - Return `{ ...env, PATH: [...toAdd, env.PATH].filter(Boolean).join(path.delimiter) }`.
- [x] 1.4 Substring presence check is case-insensitive on Windows (PATH semantics).
- [x] 1.5 Document the idempotence invariant in jsdoc: calling twice on the same env returns identical result.

## 2. Re-export shim

- [x] 2.1 Create `packages/electron/src/lib/ensure-windows-path.ts`:
  ```ts
  /**
   * Re-export shim — implementation lives in shared so the dashboard
   * server can call it without depending on the electron package.
   */
  export { ensureWindowsSystemPath } from "@blackbelt-technology/pi-dashboard-shared/platform/ensure-windows-path.js";
  ```

## 3. Wire into `buildSpawnEnv`

- [x] 3.1 In `packages/shared/src/platform/binary-lookup.ts::buildSpawnEnv`, at the very end (after the PATH-prepend logic), wrap the return value with `ensureWindowsSystemPath(...)`:
  ```ts
  const out = parts.length === 0 ? base : { ...base, PATH: `${parts.join(path.delimiter)}${path.delimiter}${currentPath}` };
  return ensureWindowsSystemPath(out);
  ```
- [x] 3.2 Import `ensureWindowsSystemPath` from the sibling module (`./ensure-windows-path.js`).
- [x] 3.3 No behavioural change on POSIX hosts (helper is no-op).

## 4. Unit tests

- [x] 4.1 Create `packages/shared/src/__tests__/ensure-windows-path.test.ts`:
  - `platform="darwin"` → returns env unchanged.
  - `platform="linux"` → returns env unchanged.
  - `platform="win32"`, PATH empty, all candidate paths exist: returns env with PATH containing exactly the 6 candidates in order.
  - `platform="win32"`, PATH=`C:\foo;C:\Windows\System32;C:\bar`, all candidates exist: System32 NOT re-added; PATH becomes `<other 5 candidates>;C:\foo;C:\Windows\System32;C:\bar`.
  - `platform="win32"`, `Wbem` directory missing on disk: `Wbem` skipped; remaining 5 added.
  - Idempotence: `ensureWindowsSystemPath(ensureWindowsSystemPath(env)) === ensureWindowsSystemPath(env)`.
  - Case-insensitive substring: PATH containing `c:\windows\system32` (lowercase) treated as already-present.
- [x] 4.2 Add a test seam: pass `exists` and `platform` via opts; defaults to `fs.existsSync` and `process.platform` respectively.

## 5. Integration via `buildSpawnEnv`

- [x] 5.1 In `packages/shared/src/__tests__/binary-lookup-spawn-env.test.ts` (new or existing), add a test that exercises `new ToolResolver({}).buildSpawnEnv({ PATH: "", SYSTEMROOT: "C:\\Windows" }, { platform: "win32" })` and asserts the resulting PATH includes `System32`. (Requires the resolver / buildSpawnEnv to accept a test-platform override; if it doesn't, expose a minimal seam.)
- [x] 5.2 Negative test: same on POSIX, PATH unchanged.

## 6. AGENTS.md correction

- [x] 6.1 Delegate to a general-purpose subagent: confirm the "Key Files" backbone row for `packages/electron/src/lib/ensure-windows-path.ts` is present and reflects the re-export shim. If absent in the current AGENTS.md (it was supposed to be there but the file disappeared from the tree), add the row per the Documentation Update Protocol.
- [x] 6.2 Same subagent: ensure `docs/file-index-shared.md` has a row for `packages/shared/src/platform/ensure-windows-path.ts` with caveman-style description.

## 7. Validate

- [x] 7.1 `npm test` — all green. (582 files / 5974 tests pass.)
- [x] 7.2 Build the bundle: `node packages/electron/scripts/bundle-server.mjs`. Confirm bundled tree at `packages/electron/resources/server/packages/shared/dist/platform/ensure-windows-path.js` exists. (NOTE: shared package ships TS sources only — no `dist/` step in this repo. Verified bundled source at `packages/electron/resources/server/packages/shared/src/platform/ensure-windows-path.ts` instead.)
- [x] 7.3 Dispatch `ci-electron.yml` `legs: win32-x64`. Download artefact. Unzip on a Windows VM. (Runs 26425246370 + 26426824035 both succeeded; tested on `C:\test6\` then `C:\test7\` after the launch-source fix was bundled in.)
- [x] 7.4 Open Settings → Tools. Verify:
  - `powershell`, `tasklist`, `taskkill` show ✓ with paths under `C:\Windows\System32\`.
  - `wmic` is either ✓ (Win 10 / pre-22H2 where it exists) or absent from the list (after `replace-wmic-with-powershell` removes its registration).
  - `pi`, `openspec`, `node-pty` still resolve via bare-import (no regression).
- [x] 7.5 Verify Doctor's "Server launch test" no longer shows ERR_UNSUPPORTED_ESM_URL_SCHEME indirectly (separate fix: `fix-doctor-windows-launch-test`).
- [x] 7.6 Spawn a pi session from the dashboard UI. Verify:
  - No "Pi started but never connected within 30s" error.
  - No `'wmic' is not recognized` lines in `~\.pi\dashboard\sessions\pi-spawn-*.log`.
  - Pi appears in the sessions list.
