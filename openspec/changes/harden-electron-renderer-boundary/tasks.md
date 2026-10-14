# Tasks

## 1. Preload split (VD5)

- [x] 1.1 Create a minimal main-window preload that exposes ONLY what the loading page needs and does NOT side-effect-import `doctor-preload` or `remote-connect-preload`.
- [x] 1.2 Point `getMainPreloadPath()` / the main `BrowserWindow` webPreferences at the minimal preload (main.ts:394).
- [x] 1.3 Confirm `remote-connect-window` and `doctor-window` still load their own bridges via their own preloads (they load trusted `file://` — unchanged).
- [x] 1.4 Verify remote content sees `window.remoteConnect === undefined` and `window.electron?.doctor === undefined`.

## 2. IPC sender validation (VD5)

- [x] 2.1 Add a `isTrustedSender(event)` helper: true only when `event.senderFrame.url` is the local `file://` loading page or the expected dashboard origin.
- [x] 2.2 Gate `request-launch`, `read-server-log`, `probe-server`, `open-doctor` handlers (main.ts:321-340) on `isTrustedSender`; reject otherwise.
- [x] 2.3 Confirm the trusted loading page still drives launch/log/probe/doctor.

## 3. openExternal allowlist (VD4)

- [x] 3.1 Add a `safeOpenExternal(url)` that opens only `http`/`https`/`mailto`, else drops.
- [x] 3.2 Use it in `setWindowOpenHandler` (main.ts:402) and the `will-navigate` open-external branch (main.ts:410 / link-handling.ts).

## 4. Probe SSRF denylist (B10)

- [x] 4.1 In `remote-probe.ts`, after scheme normalization, resolve the host and reject link-local/unspecified targets before fetch (loopback/RFC1918 stay allowed — LAN remotes are the primary use case; decided with the user).
- [x] 4.2 Ensure `probeServer` is only wired to the trusted wizard window (covered by 1.x + 2.x).

## Tests

- [x] T1 Remote frame: `window.remoteConnect`/`window.electron.doctor` undefined in the main window after loadURL(remote).
- [x] T2 IPC sender: a call from a remote-origin frame to read-server-log/probe/request-launch/open-doctor is rejected; a call from the trusted loading frame succeeds.
- [x] T3 openExternal: `file://`, `ms-msdt:`, `search-ms:` dropped; `https://` opened. (Both window-open and will-navigate paths.)
- [x] T4 Probe: `http://169.254.169.254/…` (and decimal/hex/mapped-v6 encodings) rejected; `10.x`/`192.168.x`/loopback and a public host still fetch `/api/health`.
- [x] T5 Regression: normal local launch + loading page UX unaffected; wizard remote-connect + doctor flows still work.

## Discipline checkpoints

- [x] D1 `doubt-driven-review` — the sender-frame check must admit the trusted `file://` loading frame and reject the remote frame; walk every legitimate caller (loading page, wizard) and prove none breaks.
- [x] D2 `security-hardening` — STRIDE the split: confirm no privileged bridge remains reachable from remote content, no scheme bypass on openExternal, no DNS-rebinding hole left unaddressed in the probe (note TOCTOU; pin or re-check if high-risk).
- [x] D3 `scenario-design` — trusted/remote/wizard frame × {launch, read-log, probe, open-doctor} + openExternal scheme set realized as T1–T5.

## Validate

- [x] V1 `openspec validate harden-electron-renderer-boundary --strict` passes.
- [x] V2 `npm test` green; add Electron main-process unit tests where feasible (sender-frame helper, safeOpenExternal, probe denylist are pure-function testable).
- [ ] V3 Manual (browser skill / Electron): attach to a remote URL, open devtools on the main window, confirm the three bridges are absent and IPC calls from the page are rejected.
