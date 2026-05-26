# Restore Windows System32 PATH ensurance — fix cascading "not found" tools

## Why

On Windows, the dashboard process inherits PATH from the Electron main process, which inherits it from however the user launched the app. In multiple legitimate launch contexts — unzipped portable run, certain Start Menu shortcuts, corporate-policy-launched executables, GUI-double-clicked .exe with stripped environment — the inherited PATH **does not include `C:\Windows\System32`** or related system paths.

When System32 is absent from PATH:
- `spawnSync("where", [binary])` fails with ENOENT because `where.exe` lives at `C:\Windows\System32\where.exe`.
- Every binary the registry tries to resolve via `whereStrategy` cascades to "not found".
- `spawnSync("powershell.exe", ...)`, `spawnSync("tasklist", ...)`, `spawnSync("taskkill", ...)`, `spawnSync("wmic", ...)` all ENOENT.
- The bridge's `process-scanner.ts` returns empty arrays (no child processes detected).
- `editor-pid-registry::defaultGetCmdline` returns `null`.
- `isVirtualMachine()` returns `false` (GPU stays on in VMs → white-screen issues).
- `Settings → Tools` displays a wall of red ✗ rows for `powershell`, `tasklist`, `taskkill`, `wmic`, `node`, `npm`, `git`, etc.

Empirically verified by a user-supplied Tools-panel screenshot from a Windows 11 install (`C:\test4\zip\x64\PI-Dashboard-win32-x64\`):
- ✓ `pi` resolves via **bare-import** (Node module resolution, doesn't touch PATH).
- ✓ `openspec` resolves via bare-import.
- ✓ `node-pty` resolves via bare-import.
- ✗ Everything else resolved via `where` fails.

The repo previously shipped `packages/electron/src/lib/ensure-windows-path.ts` (per the AGENTS.md "Key Files" backbone — still listed there as authoritative) and a shared sibling `packages/shared/src/platform/ensure-windows-path.ts`. **Neither file exists in the current tracked tree.** The function `ensureWindowsSystemPath` is referenced nowhere in `packages/`. The PATH-ensurance mechanism was either never landed past a feature branch or was removed without propagating the cleanup to AGENTS.md.

Result: every Windows install that doesn't inherit a "rich" PATH from the launcher is degraded. The Tools panel makes this visible. The user-reported "Pi started but never connected within 30s" and `'wmic' is not recognized` errors are downstream effects.

## What Changes

- **Create `packages/shared/src/platform/ensure-windows-path.ts`** exporting pure helper `ensureWindowsSystemPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv`. On non-Windows hosts: no-op (returns `env` unchanged). On Windows: prepends the following directories to `env.PATH` if they exist on disk AND are not already present:
  - `C:\Windows\System32` (where.exe, tasklist.exe, taskkill.exe, etc.)
  - `C:\Windows` (notepad.exe, regedit.exe, etc.)
  - `C:\Windows\System32\Wbem` (wmic.exe on Win 10 / pre-22H2)
  - `C:\Windows\System32\WindowsPowerShell\v1.0` (powershell.exe)
  - `C:\Windows\System32\OpenSSH` (ssh.exe — used by some pi flows)
  - User-scoped: `%LOCALAPPDATA%\Microsoft\WindowsApps` (winget shims)
- **Wire into `buildSpawnEnv`** in `packages/shared/src/platform/binary-lookup.ts`. Call `ensureWindowsSystemPath` on the result before returning. Idempotent — calling twice is harmless.
- **Pure helper for testability**: `ensureWindowsSystemPath` accepts an optional `{ exists, platform }` test seam so unit tests on POSIX hosts can exercise the Windows branch without touching the real filesystem.
- **Re-create `packages/electron/src/lib/ensure-windows-path.ts`** as a re-export shim pointing at the shared implementation (per the original 8f47db2d design). Keeps existing imports (if any) working; new code should import from shared.
- **AGENTS.md correction**: the "Key Files" row for `ensure-windows-path.ts` becomes accurate again. No spec dir changes needed beyond this proposal's delta.
- **Unit tests**:
  - Helper-on-POSIX: returns env unchanged.
  - Helper-on-Win32 with all paths present + PATH empty: PATH is prepended with the six directories in order.
  - Helper-on-Win32 with `Windows\System32` already in PATH: not re-added (no duplicate).
  - Helper-on-Win32 with `Wbem` directory missing on disk: skipped (no broken-path entries inserted).
  - Helper called twice: second call is a no-op (idempotent invariant).
- **Smoke verification**: dispatch `ci-electron.yml` `legs: win32-x64`, unzip on a fresh Windows VM (or `C:\test5\`), open Settings → Tools. All system tools that physically exist (`powershell`, `tasklist`, `taskkill`, `node` if bundled-node dir is included, etc.) SHALL show green ✓.

## Capabilities

### Modified Capabilities

- `dashboard-server`: adds a Requirement that the Windows spawn environment SHALL include System32 and related canonical system paths, regardless of the inherited PATH state.

## Impact

- **Scope**: 1 new file (`ensure-windows-path.ts` in shared, ~50 LOC), 1 re-export shim (electron, 3 LOC), 1 call-site in `buildSpawnEnv` (3 LOC), unit tests (~80 LOC). Net ~140 LOC added.
- **User-visible**:
  - Settings → Tools panel goes from "everything red except 3 bare-import rows" → "system tools green ✓".
  - Bridge's process-scanner actually enumerates child processes (was returning empty).
  - Editor-pid-registry resolves command lines (was returning null).
  - VM detection works (GPU correctly disabled in VMs).
  - The cascading "wmic not recognized" stderr noise stops (because PATH-based wmic finds it on Win 10 — and even on Win 22H2+ where wmic is removed, `where wmic` returns empty cleanly via spawnSync without leaking to stderr, AND `replace-wmic-with-powershell` then takes care of the missing wmic.exe gracefully).
- **Risk**: very low. Strictly additive — prepends to PATH only when missing, only on Windows, only for paths that physically exist on disk. Cannot break any existing-working install.
- **Sequencing**: should land BEFORE `replace-wmic-with-powershell`. With PATH fixed, PowerShell resolves correctly, and the wmic→PowerShell replacement is both effective AND defence-in-depth.
- **Sibling concern — Settings → Tools UX**: after this fix, `node` and `npm` still show red on Win installs without system Node (the bundled-node dir at `<resources>/node/` isn't in the registry's search list — it's used directly by `pickNodeForServer`). That's a separate UX cleanup, not blocking. Tracked as `register-bundled-node-in-tool-registry` (future).
- **Out of scope**:
  - Adding the bundled-node dir to registry probes (separate cleanup).
  - Replacing `wmic` with PowerShell (`replace-wmic-with-powershell` — independent, lands after this).
  - Doctor's "pi CLI Not found" false positive (`fix-doctor-bundle-aware-probes` — independent).
  - Auditing every other Electron-spawned child for the same PATH issue (assume `buildSpawnEnv` is the canonical entry; verify via grep but don't expand scope).
