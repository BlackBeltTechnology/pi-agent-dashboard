# Tasks

## 1. Rewrite `isVirtualMachine` Windows branch

- [ ] 1.1 In `packages/shared/src/platform/commands.ts`, replace the `if (platform === "win32") { ... }` block with a PowerShell-based probe.
- [ ] 1.2 New script (single PowerShell invocation for both checks, returns concatenated string):
  ```ps1
  $b = (Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue).SerialNumber;
  $c = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue | Select-Object -Property Manufacturer,Model | Out-String;
  Write-Output "$b`n$c"
  ```
- [ ] 1.3 Invoke via `spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", script], { encoding: "utf-8", windowsHide: true, stdio: ["ignore","pipe","pipe"], timeout: 8000 })`. No shell. Combined timeout 8 s (2 cmdlets × ~3 s each + overhead). On non-zero exit or empty output, return `false`.
- [ ] 1.4 Regex unchanged: `/VMware|VirtualBox|VBOX|Parallels|Virtual Machine|Hyper-V/i`.
- [ ] 1.5 Extract a **pure parser helper** `parseVmProbeOutput(text: string): boolean` so unit tests can exercise the regex without spawning.

## 2. Rewrite `editor-pid-registry::defaultGetCmdline` Windows branch

- [ ] 2.1 In `packages/server/src/editor-pid-registry.ts`, replace the wmic execSync with a PowerShell spawnSync:
  ```ts
  const script = `(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`;
  const r = spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", script], { encoding: "utf-8", windowsHide: true, stdio: ["ignore","pipe","ignore"], timeout: 5000 });
  if (r.status !== 0) return null;
  const cmdline = (r.stdout || "").trim();
  return cmdline || null;
  ```
- [ ] 2.2 No need for output regex parsing — the cmdlet returns the CommandLine property directly.
- [ ] 2.3 Add unit test stubbing `spawnSync` returning `{ status: 0, stdout: "node.exe foo.js" }`; assert `defaultGetCmdline(pid)` returns the trimmed string.
- [ ] 2.4 Add negative test: `{ status: 1, stdout: "" }` → returns `null`.

## 3. Strip wmic from the bridge's process-scanner code path

- [ ] 3.1 In `packages/extension/src/process-scanner.ts::getWindowsDescendants`, REMOVE the wmic spawnSync attempt entirely. Replace with a direct call to `getWindowsDescendantsTasklist` (which uses PowerShell Get-CimInstance). The wmic path was already a "try first, fallback on failure" — eliminating the try saves the failed-spawn cost on every 10-s scan on Win 11 22H2+.
- [ ] 3.2 Rename `getWindowsDescendantsTasklist` → `getWindowsDescendantsCim` (the name is now load-bearing — it's the primary path, not a fallback).
- [ ] 3.3 Keep `wmicDateToElapsedMs` (still used? check — if no callers, delete it as orphan).
- [ ] 3.4 Update the existing process-scanner tests: the test "falls back to PowerShell when wmic fails" becomes irrelevant (no wmic try); the test "returns empty when wmic and PowerShell fail" becomes "returns empty when PowerShell fails". Rename + simplify the test cases.

## 4. Remove wmic tool registration

- [ ] 4.1 In `packages/shared/src/tool-registry/definitions.ts:472`, delete the line `registry.register(binaryDef("wmic", deps));`. Keep `powershell`, `tasklist`, `taskkill`.
- [ ] 4.2 Search for any other reference to `"wmic"` in the registry helpers and tests. Update / delete as needed.
- [ ] 4.3 Update `Settings → Tools` UI: if there's a hard-coded enumeration that includes `wmic`, remove the entry. Otherwise the row simply disappears automatically.

## 5. Tests

- [ ] 5.1 Pure parser test for `parseVmProbeOutput`:
  - Empty input → `false`.
  - Input containing "VMware Virtual Platform" → `true`.
  - Input containing "Hyper-V" → `true`.
  - Input containing "Dell Inc.\nLatitude 7420" → `false`.
- [ ] 5.2 Spawn-stub test for `isVirtualMachine({ platform: "win32", spawnSync: stub })`:
  - Stub returns `{ status: 0, stdout: "Dell Inc.\nLatitude" }` → `false`.
  - Stub returns `{ status: 0, stdout: "VMware\nVirtual Platform" }` → `true`.
  - Stub throws → `false`.
  - Stub returns `{ status: 1, stdout: "" }` → `false`.
- [ ] 5.3 Integration smoke (POSIX-skip on Windows-only path): `isVirtualMachine` on macOS still uses `sysctl -n hw.model`. On Linux still uses `systemd-detect-virt`. Existing tests for those branches stay green.
- [ ] 5.4 process-scanner test: with `spawnSync` stub returning the Get-CimInstance JSON output, `scanWindowsProcesses` returns the parsed `ChildProcessInfo[]`. No wmic stub needed.

## 6. Documentation

- [ ] 6.1 Delegate to a general-purpose subagent: update `docs/file-index-shared.md` (or wherever `commands.ts` lives) — note wmic→PowerShell replacement.
- [ ] 6.2 Delegate: update `docs/file-index-extension.md` row for `process-scanner.ts` — note the wmic fast-path removal.
- [ ] 6.3 Delegate: update AGENTS.md "Key Files" if either `commands.ts` or `process-scanner.ts` is in the backbone — append `See change: replace-wmic-with-powershell`.

## 7. Validate

- [ ] 7.1 Run `npm test` — all green. Existing wmic-related tests should be deleted, not patched.
- [ ] 7.2 Build the bundle locally: `node packages/electron/scripts/bundle-server.mjs`. Confirm no wmic references in `<bundle>/packages/shared/dist/platform/commands.js` post-build.
- [ ] 7.3 Manual smoke: dispatch `ci-electron.yml` `legs: win32-x64`. Download artifact. Unzip on a Win 11 22H2 VM. Verify:
  - Electron starts; no "wmic not recognized" anywhere in `<TEMP>\pi-dashboard-electron.log`.
  - Doctor's tool list does NOT include a red "wmic Not found" row.
  - Spawning a pi session via the dashboard UI: pi's session log at `~\.pi\dashboard\sessions\pi-spawn-*.log` contains no wmic noise.
  - If the host is itself a VM: GPU is correctly disabled (`disableGpu=true` in Electron log).
- [ ] 7.4 Verify on Win 10 (where wmic still exists by default): same checks pass — no regression. PowerShell takes the same code path; Win 10's PowerShell is fine.
