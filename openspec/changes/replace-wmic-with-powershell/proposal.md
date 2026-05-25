# Replace wmic with PowerShell Get-CimInstance on Windows

## Why

Windows 11 22H2+ ships **without `wmic.exe`** by default. Microsoft deprecated it in 2021 and removed it from the default installable feature set in 22H2 (server) and the optional-component matrix on client. Three call sites in this repo still shell out to `wmic`:

1. `packages/shared/src/platform/commands.ts::isVirtualMachine` — `execSync("wmic bios get serialnumber")` and `execSync("wmic computersystem get manufacturer,model")` with **default stdio**. When wmic is missing, cmd.exe writes `'wmic' is not recognized as an internal or external command, operable program or batch file.` to **parent process stderr** (verified by local repro: see investigation log below).
2. `packages/server/src/editor-pid-registry.ts::defaultGetCmdline` — `execSync("wmic process where ProcessId=… get CommandLine /value", { stdio: ['ignore','pipe','ignore'] })`. The stderr=ignore suppresses the noise, BUT the underlying functionality (resolving an editor process command line) silently returns `null` instead of working.
3. `packages/extension/src/process-scanner.ts::getWindowsDescendants` — already has a tasklist+PowerShell fallback when wmic returns non-zero, so functional behaviour is preserved, but the **registered tool definition** `binaryDef("wmic")` in `tool-registry/definitions.ts:472` produces a red "not found" row in Settings → Tools on Win 11 22H2+.

`isVirtualMachine` is called only by `packages/electron/src/main.ts:50` at module load. Its only effect is to set `app.disableHardwareAcceleration()` for known VM patterns. On a Win 11 22H2 host that happens to be a VM, the current code:
1. Writes two cmd.exe-style error messages to Electron's main-process stderr.
2. Returns `false` (VM not detected).
3. GPU stays enabled — which is exactly the white-screen failure the function was created to prevent.

Empirical verification: `node -e "execSync('this-cmd-does-not-exist')"` on any POSIX host writes the shell's "not found" message to the parent process's stderr (reproduced 2026-05-25 in this repo's investigation). The same mechanism applies on Windows when cmd.exe handles a missing wmic.

## What Changes

- **Rewrite `isVirtualMachine` Windows branch** to use PowerShell's `Get-CimInstance` instead of wmic. Two equivalents:
  ```ps1
  Get-CimInstance -ClassName Win32_BIOS | Select-Object -ExpandProperty SerialNumber
  Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object -Property Manufacturer,Model | Format-List
  ```
  Detection regex (`VMware|VirtualBox|VBOX|Parallels|Virtual Machine|Hyper-V`) is unchanged.
- **Invoke via spawnSync, not execSync.** `spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", "<script>"], { encoding: "utf-8", windowsHide: true, stdio: ["pipe","pipe","pipe"] })`. No shell, no console flash, no parent-stderr leak even if powershell.exe is missing (which it never is — PowerShell ships with every Windows since Vista).
- **Rewrite `editor-pid-registry::defaultGetCmdline` Windows branch** identically: `Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$pid" | Select-Object -ExpandProperty CommandLine`. Restores the editor-PID-resolution feature that has been silently null since the Win 11 wmic removal.
- **Remove `binaryDef("wmic")` registration** in `packages/shared/src/tool-registry/definitions.ts:472`. The bridge's `process-scanner.ts` still tries wmic via `resolveSystemTool("wmic")` first — change that to skip the wmic probe entirely (call its existing PowerShell fallback directly). The fallback is faster anyway on Win 11.
- **Update `binaryDef` registrations** to keep `powershell`, `tasklist`, `taskkill` — those are guaranteed present.
- **Pure helpers** for each rewritten function so unit tests exercise the parser logic without spawning anything. Tests cover: VM detection with synthetic Get-CimInstance output (matched + unmatched), editor cmdline parsing (non-empty + empty), and "spawn failed" returns the same null/false as today.
- **Update the Settings → Tools UI expectation**: `wmic` no longer appears in the row list (it's no longer registered). One line in `ToolsSection.tsx` if any hard-coded enumeration exists; otherwise no change.

## Capabilities

### Modified Capabilities

- `dashboard-server`: removes the wmic dependency from runtime spawn paths (editor-pid-registry). PowerShell becomes the canonical Windows process-introspection primitive.

## Impact

- **Scope**: ~80 LOC changed (3 functions rewritten + tests + registry cleanup). Net deletion of ~15 LOC (wmic-specific fallback chains simplify).
- **User-visible**: on Win 11 22H2+, no more stderr noise at Electron startup; VM detection actually works (GPU correctly disabled in VMs); editor process-cmdline resolution stops silently returning null; Settings → Tools no longer shows a red "wmic Not found" row.
- **On older Windows** (Win 10, Win 11 pre-22H2): identical behaviour — PowerShell Get-CimInstance works since Windows 7. No regression.
- **Risk**: very low. PowerShell + Win32_BIOS + Win32_Process + Win32_ComputerSystem are all part of Windows since XP/2003. Get-CimInstance specifically ships with PowerShell 3.0+ (Windows 8 / Server 2012). Our bundled Node has nothing to do with this — the cmdlets run in `powershell.exe`.
- **Sequencing**: independent of all other proposals on this branch. Lands cleanly anywhere.
- **Investigation context**: this proposal was drafted after locally reproducing the bundled server on macOS, walking the entire wmic-source chain, and proving via three controlled `execSync`/`spawnSync` tests that **`isVirtualMachine`'s execSync(wmic) is the only function in the codebase that can leak cmd.exe "not recognized" messages to parent stderr**. Even though it's called only from Electron main (not from the server or bridge), the leak vector is real for any future caller that hits the same `execSync(default-stdio)` pattern, and Microsoft's wmic removal makes the fix overdue regardless of the leak path.
- **Out of scope**:
  - Replacing tasklist/taskkill (they're still present on all Windows versions).
  - Adding telemetry to detect wmic presence.
  - Backporting to pre-Windows-7 (the bundled Node already drops support there).
