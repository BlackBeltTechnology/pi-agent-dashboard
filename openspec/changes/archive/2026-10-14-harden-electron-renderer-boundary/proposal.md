# Harden Electron Renderer Boundary

## Why

The security-boundary-audit verified two High findings in the Electron shell's
remote mode, plus a coupled SSRF (VD5, VD4, B10). The webPreferences posture is
already good (`nodeIntegration:false` + `contextIsolation:true` on every window);
the risk is concentrated in what the **main window's preload exposes to untrusted
remote content** and in **unfiltered `shell.openExternal`**.

1. **Shared privileged preload on the remote window (VD5, confirmed).** In remote
   mode `createMainWindow(remoteUrl)` (`main.ts:524-528`) does
   `loadURL(remoteUrl)` (416) over plain http with
   `webPreferences.preload = getMainPreloadPath()` (394). `preload.ts`
   side-effect-imports **all three** bridges — `doctor-preload` (`window.electron.doctor`,
   line 9), `remote-connect-preload` (`window.remoteConnect`, line 12) — and
   exposes `piDashboard` (line 65). So a MITM'd or malicious remote/Docker server
   can call `remoteConnect.connect(attackerUrl)` (persistent redirect/pin),
   `piDashboard.readServerLog()` (local log exfil), `electron.doctor.run()`
   (spawn local detection processes), and `piDashboard.probeServer(...)`. None of
   the `ipcMain.handle` handlers (`main.ts:321-340`) validate `event.senderFrame`.

2. **`shell.openExternal` has no scheme allowlist (VD4, confirmed).**
   `setWindowOpenHandler((details) => { void shell.openExternal(details.url) })`
   (`main.ts:401-403`) forwards **any** scheme; the `will-navigate` open-external
   branch does the same (`main.ts:410`). Remote content invoking
   `window.open("file:///…")` / `ms-msdt:` / `search-ms:` reaches the OS protocol
   handler → known protocol-handler RCE chains (Windows) / arbitrary app+file
   launch (macOS).

3. **SSRF + version oracle from the untrusted renderer (B10, coupled).**
   `piDashboard.probeServer` → `fetch(\`${url}/api/health\`)` (`remote-probe.ts`)
   has no host restriction and is reachable from remote content (via #1). An
   attacker probes `169.254.169.254` / internal hosts.

## What Changes

- **Split the preload by trust.** The main window (which loads remote content)
  SHALL use a **minimal preload** that does NOT import the wizard bridges
  (`remoteConnect`, `doctor`). Those bridges remain on their own dedicated wizard
  windows (`remote-connect-window`, `doctor-window`), which load trusted local
  `file://` content only.
- **Validate the sender frame in every IPC handler.** Privileged handlers
  (`request-launch`, `read-server-log`, `probe-server`, `open-doctor`) SHALL
  reject calls whose `event.senderFrame` origin is not the trusted local frame
  (the `file://` loading page or the expected dashboard origin), so even an
  exposed API cannot be driven by the remote frame.
- **Enforce a scheme allowlist on `shell.openExternal`.** Both
  `setWindowOpenHandler` and the `will-navigate` open-external branch SHALL open
  externally only `http`/`https`/`mailto`; all other schemes SHALL be dropped.
- **Constrain the reachability probe.** `probeServer` SHALL reject targets that
  resolve to loopback, private (RFC1918), or link-local ranges, and SHALL be
  callable only from the trusted wizard window.

Out of scope: the `dependency-detector.ts:91` local `execSync` (audit B24, low,
local-only); the non-Electron findings.

## Impact

- **Closes:** VD5 remote-renderer→privileged-IPC, VD4 `openExternal` scheme
  abuse, B10 SSRF/version oracle.
- **Risk:** the loading page legitimately uses `piDashboard` (launch, read-log,
  probe, open-doctor); the sender-frame check must correctly admit the trusted
  local loading frame while rejecting the remote frame. Getting this wrong breaks
  the launch/loading UX — hence `doubt-driven-review` + a trusted-vs-remote frame
  scenario matrix.
- **Affected specs:** new capability `electron-renderer-hardening`.
- **Affected code:** `packages/electron/src/main.ts`, `preload.ts` +
  `preload/*.ts`, `remote-probe.ts`, `link-handling.ts`.

## Discipline Skills

- `security-hardening` — Electron renderer/preload boundary, IPC sender
  validation, `openExternal` allowlist, SSRF denylist.
- `doubt-driven-review` — prove the trusted loading page still works after the
  sender-frame check and preload split before merge.
- `scenario-design` — trusted-frame vs remote-frame vs wizard-frame matrix across
  each privileged IPC and the openExternal scheme set.
