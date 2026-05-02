## ADDED Requirements

### Requirement: Power-user mode runs `installStandalone()` even when the wizard UI is skipped
The Electron main-process startup logic in `packages/electron/src/main.ts` SHALL run `installStandalone()` (or its dependency-installer equivalent) on every first launch, regardless of whether the wizard UI is shown. The current "auto-skip wizard when `pi.found && bridge.found`" optimisation SHALL be limited to suppressing the *user-facing wizard window*; it SHALL NOT skip the *managed dependency install*.

The two concerns are orthogonal:
- *Show wizard UI?* — depends on user state (skip if pi+bridge already present)
- *Install managed dependencies?* — should ALWAYS run on first launch (the bundled server's runtime requires `tsx`/`pi-coding-agent`/`openspec` to be in the managed dir, NOT in the user's system pi)

Conflating them produced Defect 1 of change `fix-electron-windows-installer-and-server-bootstrap`: the user's `~/.pi-dashboard/node_modules/` stayed empty after the auto-skip path, so the bundled server had no `tsx` / `pi-coding-agent` / `openspec` to load and crashed with `MODULE_NOT_FOUND` (after falling back to system pi 0.71.x's broken jiti).

#### Scenario: Power-user first launch installs managed dependencies
- **WHEN** the Electron app launches for the first time AND `pi.found && bridge.found` evaluates to true
- **THEN** the wizard UI SHALL NOT be shown (preserves the existing optimisation)
- **AND** `installStandalone()` SHALL be called and complete (or fail loudly with a user-visible error)
- **AND** `~/.pi-dashboard/node_modules/` SHALL contain `tsx`, `@mariozechner/pi-coding-agent` at the pinned version, and `@fission-ai/openspec` at the pinned version after the install completes

#### Scenario: Subsequent launches in power-user mode are fast
- **WHEN** the Electron app launches for the second or later time in power-user mode AND `~/.pi-dashboard/node_modules/` is already populated with the expected packages at the expected versions
- **THEN** `installStandalone()` SHALL detect the populated state and return immediately (idempotency check)
- **AND** the launch SHALL not be measurably slower than today's auto-skip path

#### Scenario: Wizard UI path also runs install
- **WHEN** the Electron app launches for the first time AND either pi or bridge is missing (so the wizard UI IS shown)
- **THEN** the wizard SHALL run `installStandalone()` as part of its existing flow (preserves current behaviour)

#### Scenario: Power-user mode + corrupt managed dir re-installs
- **WHEN** the Electron app launches in power-user mode AND `~/.pi-dashboard/node_modules/` exists but is missing one or more pinned packages
- **THEN** `installStandalone()` SHALL detect the partial state and re-install the missing packages

#### Scenario: Loading page shows install progress
- **WHEN** `installStandalone()` is running during the auto-skip path's first launch
- **THEN** the Electron main window's loading page SHALL display a "Setting up dependencies..." indicator
- **AND** the indicator SHALL switch to "Connecting to server..." once `installStandalone()` completes and the server-launch step begins

### Requirement: `detectPiDashboardCli()` filters for executable extensions on Windows
On Windows, `detectPiDashboardCli()` in `packages/electron/src/lib/dependency-detector.ts` SHALL filter the output of `where pi-dashboard` for files with one of the executable extensions `.cmd`, `.exe`, `.bat`, `.ps1` (case-insensitive) and prefer the first such match. This SHALL fall back to `lines[0]` only when no candidate has a recognised executable extension. POSIX behaviour (single line from `which`) SHALL be unchanged.

This requirement exists because npm-global installs on Windows produce both an extensionless POSIX shim AND a `.cmd` shim for each binary; `where` returns both lines; `lines[0]` is the extensionless one; `spawn(path, args, { shell: false })` cannot invoke an extensionless shim on Windows and produces `ENOENT`. Filtering for executable extensions ensures we always pick the spawnable candidate.

#### Scenario: Windows picks `.cmd` over extensionless shim
- **WHEN** `where pi-dashboard` returns multiple lines on Windows including both an extensionless shim AND a `.cmd` shim
- **THEN** `detectPiDashboardCli()` SHALL return the path ending in `.cmd`

#### Scenario: Windows picks `.exe` when present
- **WHEN** `where pi-dashboard` returns a `.exe` candidate alongside the extensionless and `.cmd` shims
- **THEN** the function SHALL return any of the executable-extension matches (the order among `.cmd` / `.exe` / `.bat` / `.ps1` is implementation-defined; the requirement is that it NOT be the extensionless one)

#### Scenario: POSIX behaviour unchanged
- **WHEN** the function runs on Linux or macOS (`process.platform !== "win32"`)
- **THEN** it SHALL return the first line of `which pi-dashboard` regardless of extension (POSIX has no `where` and no extensionless-shim concern)

#### Scenario: No executable extension found, fall back to lines[0]
- **WHEN** `where pi-dashboard` returns multiple lines on Windows AND none have a recognised executable extension
- **THEN** the function SHALL return `lines[0]` (preserves the current behaviour for unusual setups; the spawn site fails loudly there if needed)

### Requirement: `shouldUrlWrapEntry()` documents jiti version contract
The `shouldUrlWrapEntry()` helper in `packages/shared/src/platform/node-spawn.ts` SHALL include a documented contract in its header comment that the Windows-non-tsx arm assumes the jiti loader is from `@mariozechner/pi-coding-agent@0.70.x` (jiti 2.x with the `file:///` triple-slash URL handling fix). The contract SHALL explicitly note that newer jiti versions (e.g. jiti 2.6.5 in pi-coding-agent@0.71.x) misnormalize triple-slash URLs and break the contract. The contract SHALL also direct future contributors to either update the contract, add a per-version branch, or switch to tsx if the offline-cacache-pinned `pi-coding-agent` is ever bumped to a version with a different jiti.

The contract is **defended in practice** by Defect 1's fix: when `installStandalone()` runs from the offline cacache, the managed dir contains `pi-coding-agent` at the version pinned in `packages/electron/offline-packages.json` (currently `0.70.0`). The runtime resolver `resolveJitiFromPi()` finds the managed version first; the system fallback (which is where jiti 2.6.5 would come from on a user's machine) is only reached when the managed dir is empty — which after Defect 1's fix should never happen.

The contract SHALL be regression-pinned by an automated test that asserts the offline-cacache-pinned `pi-coding-agent` version falls within the supported range (`0.70.x`).

#### Scenario: Header comment documents the version contract
- **WHEN** `packages/shared/src/platform/node-spawn.ts` is read
- **THEN** the `shouldUrlWrapEntry` function's header comment SHALL contain the strings "jiti version contract" and "0.70.x"
- **AND** SHALL contain at least one of the strings "0.71" / "2.6.5" identifying the known-broken jiti version
- **AND** SHALL contain remediation guidance (re-verify, add per-version branch, OR switch to tsx)

#### Scenario: Test asserts offline-cacache pi version is in the supported range
- **WHEN** the regression-pin test (`node-spawn-jiti-contract.test.ts`) runs
- **THEN** it SHALL read the `@mariozechner/pi-coding-agent` pin from `packages/electron/offline-packages.json`
- **AND** SHALL fail if the version does not begin with `0.70.` (i.e. is not within the contract-supported range)

## MODIFIED Requirements

### Requirement: Server-startup deadline is 60 seconds with cause-aware error wording
The `waitForReady` callsites in `server-lifecycle.ts` SHALL use a deadline of `60_000` milliseconds (60 seconds), not `15_000`. The error message constructed when `waitForReady` returns unsuccessful SHALL distinguish two cases — child process exiting prematurely vs. deadline elapsed without the probe returning true — and use different wording for each. The current behaviour conflates both cases under "Server failed to start within 15 seconds (child exited with code N)", which is misleading because in the child-exit case the deadline is never actually reached.

#### Scenario: Deadline is 60 seconds at every callsite
- **WHEN** `server-lifecycle.ts` is parsed
- **THEN** every `waitForReady` call SHALL pass `deadlineMs: 60_000`

#### Scenario: Child-exit error wording
- **WHEN** the spawned server child process exits before the probe returns true
- **THEN** the thrown error SHALL begin with "Server child process exited prematurely (...)"
- **AND** SHALL include a hint identifying the typical cause ("usually means a missing dependency or wrong TypeScript loader")
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

#### Scenario: Deadline-exceeded error wording
- **WHEN** the deadline elapses without either the probe returning true or the child exiting
- **THEN** the thrown error SHALL begin with "Server did not respond within 60 seconds (...)"
- **AND** SHALL include the hint "The server is likely still starting; try the Retry button"
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

### Requirement: Server launch via tsx binary
The server SHALL be launched using the `tsx` binary (not `node --import tsx/esm`) to ensure proper `__dirname`/`__filename` shimming for CJS dependencies. When `tsx` is not available, the server SHALL fall back to spawning `node` with a `jiti` ESM loader; the jiti loader SHALL be resolved via the existing `resolveJitiFromPi()` chain (managed install first, then system pi). The bundled server tree (`resources/server/node_modules/`) does NOT contain `pi-coding-agent` and SHALL NOT be a candidate in the resolution chain — the runtime model is "tsx and pi live in the managed dir; the bundled tree only contains workspace deps."

#### Scenario: tsx binary resolution
- **WHEN** the server needs to be launched
- **THEN** it SHALL find the `tsx` binary in `~/.pi-dashboard/node_modules/.bin/tsx` (managed) or system PATH

#### Scenario: Server launch with tsx
- **WHEN** launching the server
- **THEN** it SHALL spawn `tsx <cli.ts> --port <port> --pi-port <piPort>` with NODE_PATH including the bundled server's node_modules

#### Scenario: Server launch logging
- **WHEN** the server is launched
- **THEN** it SHALL write launch diagnostics and server output to `~/.pi-dashboard/server.log`

#### Scenario: jiti fallback uses managed install first
- **WHEN** `tsx` is not found
- **THEN** the jiti loader passed to `node --import` SHALL be resolved from `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent` (managed install) BEFORE checking the system pi install
- **AND** the resolver SHALL NOT check the bundled server's `node_modules` (which intentionally does not contain pi-coding-agent — see the `electron-build-pipeline` spec)
