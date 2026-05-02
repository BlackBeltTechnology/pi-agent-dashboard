## 1. Naming alignment — single user-visible name `pi-dashboard`

- [x] 1.1 Edit `packages/electron/package.json`: change `"productName": "pi-dashboard-electron"` → `"productName": "pi-dashboard"`. Leave the npm `name` field (`@blackbelt-technology/pi-dashboard-electron`) untouched per design.md Non-Goal §1. **DONE in this branch.**
- [x] 1.2 Edit `packages/electron/forge.config.ts` NSIS maker config. Replace the current minimal `getAppBuilderConfig` callback with the explicit override:
  ```ts
  getAppBuilderConfig: async () => ({
    publish: null,
    productName: "pi-dashboard",
    appId: "com.blackbelt-technology.pi-dashboard",
    nsis: {
      artifactName: "pi-dashboard-Setup-${version}.exe",
      shortcutName: "pi-dashboard",
      uninstallDisplayName: "pi-dashboard",
    },
  }),
  ```
  **DONE in this branch.**
- [x] 1.3 Verify locally on Windows (`B:\Dev\BB\pi-agent-dashboard`): clean uninstall the existing `@blackbelt-technologypi-dashboard-electron` install via Apps & Features, run `npm run electron:make -- --arch=x64`, run the new Setup `.exe`, confirm install dir is `%LOCALAPPDATA%\Programs\pi-dashboard\`, Start Menu shortcut launches the app on first try, Apps & Features lists the app as `pi-dashboard`.
- [x] 1.4 Run `npm run lint` — no new TS errors.

## 2. Bundle-server architectural lock — pi is intentionally NOT bundled

- [x] 2.1 Edit `packages/electron/scripts/bundle-server.mjs` to NOT declare `@mariozechner/pi-coding-agent` (or any managed-dir-resident dep) as a dependency in the synthetic workspace `package.json`. Add a comment block at the synthetic-pkg construction site explaining that pi belongs in the managed dir per the offline-cacache architecture, citing change `fix-electron-windows-installer-and-server-bootstrap`. **DONE in this branch (revert of an earlier mistaken `/opsx:apply` session that had bundled pi).**
- [x] 2.2 Verify the revert end-to-end on Linux: `rm -rf packages/electron/resources/server && node packages/electron/scripts/bundle-server.mjs`, confirm bundle is approximately 80MB (not 160MB), confirm `ls packages/electron/resources/server/node_modules/@mariozechner` returns no such directory.

## 3. Defect 1 — wizard auto-skips installStandalone in power-user mode

- [x] 3.1 Edit `packages/electron/src/main.ts`'s startup flow around lines 386-426. The current logic is approximately:
  ```ts
  if (firstRun) {
    if (pi.found && bridge.found) {
      writeModeFile("power-user");
      // installStandalone NEVER CALLED ← Defect 1
    } else if (pi.found && !bridge.found) {
      openWizardWindow("bridge-install");
    } else {
      openWizardWindow();
    }
  }
  ```
  Change to:
  ```ts
  if (firstRun) {
    if (pi.found && bridge.found) {
      writeModeFile("power-user");
      // Defect 1 fix: still install managed deps even when wizard UI is skipped.
      // Async — the main window's loading-page UI handles the wait.
      void runPowerUserManagedInstall().catch((err) => {
        console.error("[pi-dashboard] managed install failed:", err);
        // Surface as a toast on the main window once it opens.
      });
    } else if (pi.found && !bridge.found) {
      openWizardWindow("bridge-install");
    } else {
      openWizardWindow();
    }
  }
  ```
  Where `runPowerUserManagedInstall()` is a thin wrapper around the existing `installStandalone()` that uses the offline-packages cache when present (per design.md §Open Question 2). Idempotent: returns early when `~/.pi-dashboard/node_modules/{tsx,@mariozechner/pi-coding-agent,@fission-ai/openspec}/package.json` are all present and at the expected version.
- [x] 3.2 Add a "Setting up dependencies..." indicator on the main window's loading page (the existing `loading.html` rendered before server-ready). Replaces the current "Connecting to server..." text when the install is in progress, switches back to "Connecting to server..." once install completes and we're waiting for `waitForReady`. Detection: simple boolean state set/cleared by the IPC channel that wraps `runPowerUserManagedInstall()`.
- [x] 3.3 Create `packages/electron/src/__tests__/wizard-power-user-managed-install.test.ts`:
  - Mock `pi.found = true`, `bridge.found = true`, `firstRun = true`. Spy on `installStandalone`. Call the startup function (extracted into a pure helper `decideStartupAction(state)`). Assert the action returned schedules a managed install AND skips the wizard UI.
  - Mock `pi.found = false`. Assert the wizard UI path is taken (and install runs as part of that).
  - Mock `pi.found = true, bridge.found = true, firstRun = false`. Assert no install runs (already past first launch).
  - Mock `firstRun = true, pi.found = true, bridge.found = true`, AND `~/.pi-dashboard/node_modules` already populated with all expected packages. Assert `installStandalone` is called but returns immediately (idempotency).
- [x] 3.4 Verify locally on Windows: with `~/.pi-dashboard/node_modules/` empty AND system pi+bridge present, run the installed app. Confirm:
  - Loading page shows "Setting up dependencies..." for ~5-15s (offline cacache extract)
  - After completion, dashboard server starts on port 8000
  - On second launch, loading page does NOT linger on "Setting up..." (idempotency check skips the install)

## 4. Defect 2 — `shouldUrlWrapEntry` jiti version contract

- [x] 4.1 Extend the header comment of `packages/shared/src/platform/node-spawn.ts::shouldUrlWrapEntry()` with the explicit jiti-version contract block (full text in design.md §D6). Keep existing comment text; append the new `!! JITI VERSION CONTRACT !!` section.
- [x] 4.2 Create `packages/shared/src/__tests__/node-spawn-jiti-contract.test.ts`:
  - Read `packages/electron/offline-packages.json`, parse, find the `@mariozechner/pi-coding-agent` pin.
  - Assert the version starts with `0.70.` (the contract-supported range).
  - Failure message cites change `fix-electron-windows-installer-and-server-bootstrap` and points the contributor to either re-verify the contract OR add a per-version branch in `shouldUrlWrapEntry()`.
- [x] 4.3 Read `packages/shared/src/platform/node-spawn.ts` source in the SAME test, assert the header comment contains:
  - The literal `jiti version contract`
  - The literal `0.70.x`
  - At least one of `0.71` / `2.6.5`
  - At least one of `re-verify` / `per-version branch` / `tsx` (remediation guidance hint)
- [x] 4.4 Run: `HOME=$(mktemp -d) npx vitest run packages/shared/src/__tests__/node-spawn-jiti-contract.test.ts`. Must pass.

## 5. Defect 3 — `detectPiDashboardCli()` Windows extension filter

- [x] 5.1 Edit `packages/electron/src/lib/dependency-detector.ts::detectPiDashboardCli()`. Replace `lines[0]` with the Windows-aware filter:
  ```ts
  const out = execSync(`where pi-dashboard`, { encoding: "utf-8" }).trim();
  const lines = out.split(/\r?\n/).filter(Boolean);
  const path = process.platform === "win32"
    ? (lines.find((l) => /\.(cmd|exe|bat|ps1)$/i.test(l)) ?? lines[0])
    : lines[0];
  ```
  POSIX (`which`) returns at most one line; the Windows-only branch is the only behavioural change.
- [x] 5.2 Create `packages/electron/src/__tests__/dependency-detector-windows-extensions.test.ts`:
  - Mock `execSync` to return a multi-line `where` output: extensionless first, then `.cmd`. Mock `process.platform = "win32"`. Assert function returns the `.cmd` path.
  - Same multi-line output, mock `process.platform = "linux"`. Assert function returns the first line (POSIX behaviour).
  - Multi-line with no executable extensions. Mock `process.platform = "win32"`. Assert function returns `lines[0]` (fallback).
  - Single-line output with `.cmd` extension. Mock `process.platform = "win32"`. Assert function returns that line.
- [x] 5.3 Run: `HOME=$(mktemp -d) npx vitest run packages/electron/src/__tests__/dependency-detector-windows-extensions.test.ts`. Must pass.

## 6. Server-startup deadline + error-wording split

- [x] 6.1 Edit `packages/electron/src/lib/server-lifecycle.ts`: change both `deadlineMs: 15_000` callsites to `deadlineMs: 60_000`.
- [x] 6.2 Edit the two error-message construction sites (around lines 305 and 433 in current source). Replace the single template with the cause-aware switch from design.md §D4. Both sites share a helper:
  ```ts
  function buildServerStartupError(args: {
    cliPath?: string;
    spawnBin: string;
    spawnArgs: string[];
    cwd: string;
    logTail: string;
    readyError: string;
  }): Error {
    const isChildExit = args.readyError.toLowerCase().includes("exit");
    const cmdLine = args.cliPath
      ? `Command: ${args.cliPath} start --port ... --pi-port ...`
      : `Command: ${args.spawnBin} ${args.spawnArgs.join(" ")}`;
    const header = isChildExit
      ? `Server child process exited prematurely (${args.readyError}).\n` +
        `This usually means a missing dependency or wrong TypeScript loader.\n`
      : `Server did not respond within 60 seconds (${args.readyError}).\n` +
        `The server is likely still starting; try the Retry button.\n`;
    const body =
      `${cmdLine}\n` +
      `CWD: ${args.cwd}\n` +
      (args.logTail ? `\nServer log:\n${args.logTail}` : "\nNo server log available.");
    return new Error(header + body);
  }
  ```
- [x] 6.3 Extend `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts` with two new assertions: both `waitForReady` callsites pass `deadlineMs: 60_000`; the helper produces different first-line text for `readyError` containing "exit" vs. "deadline".
- [x] 6.4 Verify locally: deliberately break the bundled server (rename `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent` to a typo), launch the installed app, observe the dialog now reads "Server child process exited prematurely (..)" with the missing-dependency hint. Restore.

## 7. Forge config naming test

- [x] 7.1 Create `packages/electron/src/__tests__/forge-config-naming.test.ts`. Load `forge.config.ts` via dynamic import, find the NSIS maker, await its `getAppBuilderConfig()` callback, assert the resolved object contains:
  - `productName === "pi-dashboard"`
  - `appId === "com.blackbelt-technology.pi-dashboard"`
  - `nsis.artifactName === "pi-dashboard-Setup-${version}.exe"`
  - `nsis.shortcutName === "pi-dashboard"`
  - `nsis.uninstallDisplayName === "pi-dashboard"`
  - `publish === null` (preserved)
- [x] 7.2 Run: `HOME=$(mktemp -d) npx vitest run packages/electron/src/__tests__/forge-config-naming.test.ts`. Must pass.

## 8. Documentation

- [x] 8.1 Update `AGENTS.md` row for `packages/electron/forge.config.ts`: add a one-line note about the `getAppBuilderConfig` overrides + cite this change.
- [x] 8.2 Update `AGENTS.md` row for `packages/electron/src/lib/server-lifecycle.ts`: add notes for "60s deadline + cause-aware error wording" + cite this change.
- [x] 8.3 Update `AGENTS.md` row for `packages/electron/src/main.ts`: add note for "**Power-user-mode managed install** (Defect 1): firstRun's `pi.found && bridge.found` auto-skip path STILL runs `installStandalone()` so the managed dir has tsx/pi/openspec for the bundled server" + cite this change.
- [x] 8.4 Update `AGENTS.md` row for `packages/electron/src/lib/dependency-detector.ts`: add note for the Windows extension filter + cite this change.
- [x] 8.5 Update `AGENTS.md` row for `packages/shared/src/platform/node-spawn.ts`: add note for the jiti version contract + cite this change.
- [x] 8.6 Update `AGENTS.md` row for `packages/electron/scripts/bundle-server.mjs`: add note for "**Architectural lock**: synthetic package.json deliberately does NOT declare `@mariozechner/pi-coding-agent` (or any managed-dir dep). Bundled tree only contains workspace deps; pi/openspec/tsx live in the managed dir per the offline-cacache architecture (see `installStandalone()`). The reverted `PI_CODING_AGENT_VERSION` / `buildSyntheticPackageJson` exports were a misdiagnosis." + cite this change.
- [x] 8.7 Update `docs/architecture.md`: extend the "Server Lifecycle" section with the deadline/error-wording contract, the power-user-mode install rule, AND the failure-chain diagram from design.md.
- [x] 8.8 Add a `### Fixed` block to `CHANGELOG.md`'s `## [Unreleased]` section with bullet items for: naming unification, Defect 1 (power-user skips install), Defect 2 (jiti version contract documented), Defect 3 (Windows extension filter), 60s deadline + error-wording split. One bullet per defect with a one-sentence "before vs after" description.
- [x] 8.9 Add the v0.4.4 → v0.4.5 manual migration block (6 steps, per design.md migration plan) to `CHANGELOG.md`'s Unreleased section under a `### Migration` heading.

## 9. Validate + verify (no push)

- [x] 9.1 Run `npm run lint` — no new TS errors beyond pre-existing baseline.
- [x] 9.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` — confirm the four new tests appear in the pass count: `forge-config-naming`, `wizard-power-user-managed-install`, `node-spawn-jiti-contract`, `dependency-detector-windows-extensions`, plus the extension to `server-lifecycle-spawn-options.test.ts`.
- [x] 9.3 Run `openspec validate fix-electron-windows-installer-and-server-bootstrap --strict` — must return "valid".
- [x] 9.4 On the Windows machine (`B:\Dev\BB\pi-agent-dashboard`):
  - Pull the branch
  - `npm install`, `npm run build`, `node packages/electron/scripts/bundle-server.mjs`, `npm run electron:make -- --arch=x64`
  - **Confirm `resources/server/node_modules/@mariozechner` directory does NOT exist** (architectural lock from §2)
  - Uninstall the broken `@blackbelt-technologypi-dashboard-electron` from Apps & Features
  - Manually delete `~/.pi-dashboard/node_modules/` so the first-run install fires
  - Run the new `pi-dashboard-Setup-<version>.exe`
  - Confirm install dir is `%LOCALAPPDATA%\Programs\pi-dashboard\` (naming fix)
  - Confirm Start Menu shortcut launches the app on first try (naming fix)
  - On first launch: confirm "Setting up dependencies..." indicator appears for ~5-15s (Defect 1 fix; offline cacache extract)
  - After install completes: confirm dashboard reaches `http://localhost:<port>` and renders the welcome screen
  - Confirm `~/.pi-dashboard/server.log` shows no `MODULE_NOT_FOUND` for `pi-coding-agent` (Defect 1 fix; managed dir populated, jiti contract holds)
  - On second launch: confirm "Setting up..." does NOT linger (idempotency)
- [x] 9.5 Hand back to the user for the push + tag + RC + real-release steps.
