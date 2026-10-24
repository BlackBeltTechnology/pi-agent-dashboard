# Test Plan — add-google-docs-pane

Stage: design   Generated: 2026-10-24

Hard gate resolved (user, 2026-10-24):
- **Overlay hide:** no latency threshold. Scenarios assert eventual hide (convergence). S2 measures the actual latency.
- **Electron coverage:** both. L1 covers logic with faked Electron objects (`webContents`, `session`, events). The `electron` level covers a small set of real-event scenarios against a **fake Google** (new infra, below).

Levels:
- `L1` vitest (`packages/*/src/**/__tests__/`);
- `L3` Playwright docker harness (`tests/e2e/`, plain browser, so only the fallback path);
- `electron` Playwright `_electron` (`tests/e2e-electron/`, real packaged/dev app);
- `manual-only` real Google (needs a signed-in account).

Test doubles:
- **fake Google** (electron level): a local HTTPS server answering for `docs.google.com`, `accounts.google.com`, `drive.google.com`, plus off-list hosts `evil.example`, `sites.google.com` and `evilgoogleusercontent.com`. It is wired by Chromium `--host-resolver-rules` and a test CA. Its pages trigger: link click to an off-list host, script `location.href`, a 302 redirect off-list, `window.open`, a subframe per host, a `beforeunload` handler toggle, a download, and permission requests.
- **fake Electron** (L1): a recording `WebContentsView`/`webContents`/`session` with event emitters (`will-navigate`, `will-redirect`, `will-frame-navigate`, `before-input-event`, `will-prevent-unload`, `did-start-navigation`, `render-process-gone`, `destroyed`, `will-download`) and a controllable clock.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Pasted URLs are validated (id length) | BVA | L1 | automated | document URLs with id lengths 9, 10, 128, 129 and chars `[A-Za-z0-9_-]`; one id with `.` | `parseGoogleUrl` | 9 → `bad-id`; 10 and 128 → `{kind:"document", id}`; 129 → `bad-id`; `.` → `bad-id` |
| E2 | Pasted URLs are validated (host/kind) | EP | L1 | automated | `https://docs.google.com/document/d/<id>/edit`, `…/spreadsheets/…`, `…/presentation/…`, `…/forms/d/<id>`, `http://docs.google.com/document/d/<id>`, `https://evil.example/document/d/<id>`, `https://drive.google.com/open?id=<id>`, `https://drive.google.com/file/d/<id>/view` | parse | three kinds accepted; forms → `bad-kind`; http → `bad-host`; evil → `bad-host`; both drive forms → `drive-link` (hint reason) |
| E3 | Open by URL (account-switched) | EP | L1 | automated | `…/spreadsheets/u/1/d/<id>/edit`, `…/u/9/…`, `…/u/10/…` | parse | `/u/1/` and `/u/9/` → spreadsheet `<id>`, `u` dropped; `/u/10/` → `bad-url` |
| E4 | Hostile id rejected | EP | L1 | automated | id segments `..%2F..%2Fx`, `a/b`, `%00abcdefghij`, `abc def ghij` | parse | each → reject, no tab path produced |
| E5 | Loaded URL is constructed (fragments) | decision-table | L1 | automated | inputs with query `usp=sharing&x=<script>` and fragments `#gid=42`, `#gid=1234567890123`, `#heading=h.abc123`, `#slide=id.p1`, `#foo`, `#gid=42&x` | `constructLoadUrl` | query dropped; `gid=42`, `heading=h.abc123`, `slide=id.p1` kept; 13-digit gid, `foo`, `gid=42&x` dropped |
| E6 | Loaded URL is constructed (resource key) | EP | L1 | automated | `url` with `resourcekey=0-AbCdEfGhIjKl`; `doc_id` + `resource_key` `0-AbCdEfGhIjKl`; resource key `0-short` | construct | first two carry `?resourcekey=0-AbCdEfGhIjKl`; `0-short` → `bad-id` |
| E7 | Tab path round-trip | EP | L1 | automated | `gdoc:doc:document:<id>`, `gdoc:doc:spreadsheets:<id>:<key>`, `gdoc:file:docs/a:b.gsheet` | parse then format | each round-trips; file path `docs/a:b.gsheet` kept verbatim |
| E8 | Pointer precedence | decision-table | L1 | automated | pointers `{url:valid}`, `{url:invalid, doc_id:valid}`, `{url:"", doc_id:valid}`, `{url:null, doc_id:valid}`, `{doc_id:valid, resource_key:k}`, `{url:valid-with-key, resource_key:other}`, `{doc_id:""}`, `{foo:"bar"}`, `{resourceKey:k, docId:x}` | `parsePointer` | url doc; `pointer-bad-url` (no fall-through); doc_id doc ×2; doc_id + k; url's key wins; `pointer-unrecognized` ×3 |
| E9 | Pointer kind from extension / mismatch | decision-table | L1 | automated | `{doc_id}` in `.gdoc`, `.gsheet`, `.gslides`, `.GSHEET`; `{url:document}` in `plan.gsheet` | parse with extension | document, spreadsheets, presentation, spreadsheets; URL kind document + `mismatch:true` |
| E10 | Pointer size cap | BVA | L1 | automated | pointer content 65 535, 65 536, 65 537 bytes (valid JSON padded) | `parsePointer` | first two parsed; 65 537 → `pointer-too-large`, no parse |
| E11 | Invalid pointers load nothing | EP | L1 | automated | content `{`, `[]`, `"str"`, `{"url":"https://evil.example/spreadsheets/d/1AbCdEfGhIjK"}` | tab body resolves | `pointer-invalid-json`, `pointer-unrecognized`, `pointer-unrecognized`, `pointer-bad-url`; `attach` never called |
| E12 | Redirect extension validation | decision-table | L1 | automated | manifests with `fileExtensions` `[".gdoc"]`, `["gdoc"]`, `[".md"]`, `[".docx"]`, `[".json"]`, `[".GDOC"]`, `[]` | manifest validation | `.gdoc` ok; `gdoc` rejected (rule); `.md`/`.docx`/`.json` rejected naming plugin + ext; `.GDOC` normalized to `.gdoc`; `[]` rejected |
| E13 | Redirect collisions | decision-table | L1 | automated | plugins A `[".gdoc"]` + B `[".gdoc"]`; A redirect `.gdoc` + B file-handler `.gdoc`; A `[".gdoc"]` + B `[".gsheet"]`; A + B colliding with B disabled | registry generation | fail naming A, B, `.gdoc`; fail naming A, B, `.gdoc`; ok; still fails (unconditional) |
| E14 | Registry carries `fileExtensions` | EP | L1 | automated | claim with `pathPrefix:"gdoc"`, `fileExtensions:[".gdoc",".gsheet"]`; same claim with `[".gdoc"]` | generate registry twice | entry exposes both fields unchanged; hash differs between the two runs |
| E15 | Redirect routing | decision-table | L1 | automated | enabled claim gdoc `[".gdoc"]`; opens of `notes.gdoc`, `NOTES.GDOC`, `notes.gdoc.bak`, `notes.txt`; same with plugin disabled | `resolveOpenTarget` | `gdoc:file:notes.gdoc`, `gdoc:file:NOTES.GDOC`, plain, plain; disabled → all plain |
| E16 | Bypass authorization | decision-table | L1 | automated | bypass requests `{requester: gdoc tab "gdoc:file:notes.gdoc", path:"notes.gdoc"}`, `{same tab, path:"other.gdoc"}`, `{requester: other plugin tab, path:"notes.gdoc"}`, `{no requester}` | `resolveOpenTarget` | plain file; redirected; redirected; redirected |
| E17 | fileKind unchanged | EP | L1 | automated | `fileKind("/w/notes.gdoc")` with and without the redirect claim registered | classify | identical results (`kind:"unknown"`, `viewer:"monaco"`) |
| E18 | Fence normalization | EP | L1 | automated | targets `https://docs.google.com@evil.example/`, `https://DOCS.Google.COM/x`, `https://docs.google.com:8443/x`, `https://xn--dcs-...` IDN lookalike, `https://docs.google.com./x` | `decideGoogleViewNavigation(top-level)` | userinfo → not allow; upper-case → allow; port → not allow; IDN lookalike → not allow; trailing-dot → not allow |
| E19 | Fence decision table | decision-table | L1 | automated | phases {navigate, redirect, frame, window-open} × targets {`docs.google.com`, `evil.example`, `sites.google.com`, `evilgoogleusercontent.com`, `mailto:a@b.c`, `javascript:x`, `about:blank`, `blob:` (allowed parent), `blob:` (off-list parent), `data:` (allowed parent)} × recentInput {true,false} | helper | allowed hosts → `allow` in every phase; `evil.example` top-level+input → `external`, no input or redirect → `blocked-redirect`; off-list frame → `drop`; `sites.google.com`/lookalike frame → `drop`; `mailto:` + input → `external`; `javascript:` → `drop`; `about:blank` frame → `allow`; `blob:`/`data:` under allowed parent → `allow`, under off-list → `drop` |
| E20 | User-initiated window (1 s) | BVA | L1 | automated | fake view; last `before-input-event` at t−999 ms, t−1000 ms, t−1001 ms; off-list `window.open` | view manager | 999 and 1000 → `openExternalIfAllowed` called; 1001 → not called, `redirect-blocked` event with host |
| E21 | Sign-in hosts validated | EP | L1 | automated | `sso.example.com`, `SSO.example.com`, `*.example.com`, `https://sso.example.com`, `sso.example.com/x`, `sso.example.com:443`, `10.0.0.1`, `[::1]`, `docs.google.com` | settings save | first accepted; second normalized to lower-case; the rest refused with reason; nothing saved for refused |
| E22 | Federated host allowed | EP | L1 | automated | `ssoHosts:["sso.example.com"]`; redirect to `https://sso.example.com/saml` and to `https://evil.sso.example.com/` | helper (redirect) | first → `allow`; subdomain → `blocked-redirect` (exact only) |
| E23 | Permissions default-deny | decision-table | L1 | automated | permissions `clipboard-sanitized-write`, `fullscreen`, `clipboard-read`, `media`, `geolocation`, `notifications`, `midi`, `hid`, `serial`, `usb`, `unknown-x` | request and check handlers | first two → true in both handlers; the rest → false in both, without prompt |
| E24 | Attach input re-validated in main | EP | L1 | automated | IPC `attach` payloads `{kind:"../x",id}`, `{kind:"document",id:"a/b"}`, `{kind,id,fragment:"x=<script>"}`, `{kind,id,url:"https://evil.example"}`, valid ref | main handler | first four → `{error}`, no view created; valid → `{viewId}`, loaded URL equals the constructed URL |
| E25 | IPC ownership | decision-table | L1 | automated | window A attaches view v1; sender B calls `setBounds(v1)`, `setVisible(v1)`, `destroy(v1)`; remote-origin sender calls `attach` | main handlers | B's calls refused, v1 untouched; remote-origin `attach` refused (trusted-sender wrapper) |
| E26 | Dedupe one view per document | state-transition | L1 | automated | window A has `(document, id1)` bound; a second `attach` for `(document, id1)` with another resource key; then for `(spreadsheets, id1)` | main | second → `already-open`, no new view; different kind → new view |
| E27 | Pointer to already-open document | state-transition | L1 | automated | pane has `gdoc:doc:document:<id>`; user opens `notes.gdoc` naming `<id>` | tab body after pointer read | existing tab focused; `gdoc:file:notes.gdoc` tab closed; `attach` not called |
| E28 | Budget BVA | BVA | L1 | automated | fake views v1–v3 live (LRU v1), no recent input, unload allowed; attach 4th; separately attach while 2 live | view manager | 4th → v1 closed via `close({waitForBeforeUnload:true})`, `released` event for v1, 3 live; with 2 live → no release |
| E29 | Input guard (10 s) | BVA | L1 | automated | LRU v1 with last input at t−9 999 ms, t−10 000 ms, t−10 001 ms; v2 idle | attach 4th | 9 999 → v1 kept, v2 released; 10 000 and 10 001 → v1 released |
| E30 | Unsaved view kept | state-transition | L1 | automated | v1 (LRU) emits `will-prevent-unload` on close; v2 allows | attach 4th | v1 kept live, release path never calls `preventDefault`; v2 released; outcome `release-blocked` then `view-released` |
| E31 | Budget blocked | state-transition | L1 | automated | v1–v3 all emit `will-prevent-unload` | attach 4th | `attach` → `{error:"budget-blocked"}`; no view created; 3 live |
| E32 | Serialized releases | state-transition | L1 | automated | two attaches arrive while a release is in flight | view manager | second waits; at most one `close()` in flight at any time; both resolve in order |
| E33 | Close while saving | state-transition | L1 | automated | tab close → `destroy(v1)`; v1 emits `will-prevent-unload` | destroy | returns `{blocked:"unsaved"}`; v1 live; tab stays open with "still saving" |
| E34 | Owner reload / crash / destroyed | state-transition | L1 | automated | owner A with v1, v2; A emits main-frame cross-document `did-start-navigation`; separately `render-process-gone`; separately `destroyed`; one view blocks unload | main | v1, v2 released (blocked one after one 5 s retry, then destroyed); budget count back to 0; same-document navigation releases nothing |
| E35 | Sign-out | decision-table | L1 | automated | views {none blocked}, {one blocked} | `signOut()` | none blocked → views destroyed, then `clearStorageData` called once with all storage types; one blocked → `{blocked:"unsaved"}`, `clearStorageData` not called |
| E36 | Availability reasons | decision-table | L1 | automated | {local origin, no switch}, {local, `--debug-cdp`}, {local, `PI_DEBUG_CDP=1`}, {local, raw `--remote-debugging-port=9333`}, {local, `--remote-debugging-pipe`}, {remote origin}, {no surface + UA `Electron/44`}, {no surface + Chrome UA} | `availability()` / client derivation | available; `debug-cdp` ×4; `remote-window`; `remote-window`; `browser` |
| E37 | Downloads | EP | L1 | automated | fake `will-download` item | handler | `setSaveDialogOptions` called with `defaultPath` under the OS Downloads dir; no `setSavePath` into the workspace; no editor open call; outcome `download` |
| E38 | Popups never create windows | EP | L1 | automated | `setWindowOpenHandler` with `https://example.org` (+input), `https://example.org` (no input), `javascript:x` | handler | every case returns `{action:"deny"}`; external opened only in the first case; `javascript:` dropped |
| E39 | Telemetry route | EP | L1 | automated | bodies `{outcome:"opened"}`, `{outcome:"nope"}`, 1 025-byte body, 1 024-byte body, burst above the craft-web rate limit | `POST /api/plugins/google-docs/telemetry` | 204-equivalent; 400; 413/400 reject; accepted; 429 after the limit; log line `telemetry <outcome> total=<n>` with no id, URL, host or path |
| E40 | Route tier registered | EP | L1 | automated | `route-tiers.ts` completeness test | test run | `/api/plugins/google-docs/telemetry` resolves to `control` |
| E41 | Restored file tab stays | state-transition | L1 | automated | persisted pane state with file tab `notes.gdoc`; plugin enabled | `load` then open `notes.gdoc` from tree | restored tab stays a file tab; the new open focuses/creates `gdoc:file:notes.gdoc` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Redirect entry points | decision-table | L1 | automated | redirect claim `.gdoc`; entry points file tree, `?file=notes.gdoc`, canvas target, `OpenFileButton`, `FileLink`, `useFileOpenRouting`, split open | each entry point opens `notes.gdoc` | every path results in `gdoc:file:notes.gdoc`; no file viewer component mounts; split computes no `fileKind` viewer for it |
| F2 | Overlay watcher | state-transition | L1 | automated | jsdom pane rect; elements: `role=dialog` overlapping, `role=menu` overlapping, `:popover-open` overlapping, portal-root child overlapping, `role=dialog` not overlapping, `role=tooltip` overlapping, toast overlapping | mount / unmount each | `setVisible(false)` + placeholder for the first four, converging to visible after unmount; no hide for non-overlapping, tooltip, toast; no `capturePage` call ever |
| F3 | Plugin dialog over a Google tab | state-transition | electron | automated | fake-Google doc live in a `gdoc:` tab; a test plugin opens a modal dialog over the pane | dialog mounts | converges to: view hidden (main reports not attached), placeholder shown, dialog button clickable; after close the view is visible again |
| F4 | Fallback in plain browser | EP | L3 | automated | docker harness, plugin enabled; workspace file `budget.gsheet` with a valid spreadsheet URL | open from file tree | `gdoc:file:budget.gsheet` tab with the fallback card "Desktop app only"; "Open in Google" opens a popup whose URL equals the constructed URL; no request to any Google host from the page |
| F5 | Pointer errors in plain browser | EP | L3 | automated | `bad.gdoc` = `{`; `evil.gdoc` = foreign host URL | open each | error states `pointer-invalid-json` / not-a-Google-document visible; no network request to any Google host |
| F6 | Show pointer file | state-transition | L3 | automated | `budget.gsheet` open as `gdoc:file:` tab | activate "Show pointer file" | the JSON file tab opens with the content; the `gdoc:` tab stays in the strip |
| F7 | Plugin disabled | state-transition | L3 | automated | plugin disabled; persisted `gdoc:file:budget.gsheet` tab; open `budget.gsheet` from tree | reload pane, open | persisted tab shows the unavailable placeholder with Close; tree open shows the JSON viewer |
| F8 | Open Google doc by URL | EP | L3 | automated | "Open Google doc…" with valid URL; with `https://drive.google.com/open?id=…` | submit | valid → `gdoc:doc:` tab with fallback card; drive link → inline hint, no tab |
| F9 | Real-event fence | decision-table | electron | automated | fake-Google doc page: link click to `evil.example` (with click), script `location.href` to `evil.example`, 302 to `evil.example`, subframes on `sites.google.com` and `docs.google.com`, `window.open` on click | trigger each | click → external open recorded (stubbed `shell.openExternal`), view URL unchanged; script and 302 → no external open, `redirect-blocked` notice in the tab; `sites.google.com` frame not loaded; `docs.google.com` frame loaded; no new `BrowserWindow` |
| F10 | Main window never navigates | EP | electron | automated | `gdoc:` tab live on the fake-Google doc | navigate around inside the view | the main window's `webContents.getURL()` stays the dashboard URL; `BrowserWindow.getAllWindows().length` unchanged |
| F11 | Isolation | EP | electron | automated | fake-Google sets cookie `G=1` | read from dashboard page and fake dashboard server | `document.cookie` lacks `G`; no request to the dashboard server carries `G` |
| F12 | Unload-checked close | state-transition | electron | automated | fake-Google page with a `beforeunload` handler set | close the tab | tab stays open with "still saving"; after the handler is cleared, close succeeds |
| F13 | Dashboard reload releases views | state-transition | electron | automated | two live views | reload the dashboard page | both views destroyed (no orphan `webContents` in main); three new views can be attached |
| F14 | Raw remote-debugging switch | EP | electron | automated | launch app with `--remote-debugging-port=<free>` | open a `gdoc:` tab | fallback card "debug CDP"; no `WebContentsView` created in main |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Pointer read refused | fault-injection (abort) | L1 | automated | `/api/file` responds 403 / 404 / network error | tab body reads pointer | `pointer-read-failed` state; no `attach`; telemetry outcome sent |
| X2 | Pointer read slow | fault-injection (delay) | L1 | automated | `/api/file` delays 5 s | tab body | loading state shown; resolves when the response arrives; tab close during the wait → no `attach` after close |
| X3 | Attach fails | fault-injection (abort) | L1 | automated | main `attach` returns `{error:"attach-failed"}` | tab body | error state with Retry; outcome `attach-failed` |
| X4 | Telemetry route down | fault-injection (abort) | L1 | automated | telemetry POST rejects | client forwarder | no user-visible error; no retry storm (≤ 1 attempt per outcome) |
| X5 | Overlay hide latency | convergence | electron | automated | dialog mounts over a live view | measure | view hidden eventually (convergence, per hard-gate answer); measured latency recorded in the S2 notes, not asserted |
| X6 | Outcome after tab close | fault-injection (ordering) | L1 | automated | tab unmounted, then main emits `view-released` for its view | plugin-root forwarder | outcome still posted once |

### Manual-only (real Google)

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | Sign-in | exploratory | — | manual-only | real Google account, default UA | open a Doc, sign in | sign-in completes in the view; no popup window; the session survives app restart |
| M2 | Federated SSO | exploratory | — | manual-only | Workspace account with SAML IdP | sign in with the IdP host absent, then added to sign-in hosts | absent → "Continue sign-in in your browser / add host" notice; added → completes in view |
| M3 | Slides present | exploratory | — | manual-only | Slides deck | Present, then Esc | fills the window; Esc returns to the pane |
| M4 | Paste | exploratory | — | manual-only | Doc and Sheet | Cmd/Ctrl+V of text copied elsewhere | pasted; no clipboard permission prompt |
| M5 | Save debounce | exploratory | — | manual-only | Doc, type then immediately close the tab | close within 1 s of typing | blocked ("still saving") or Google-synced; no lost characters after reopening |
| M6 | Overlay feel | visual/subjective | — | manual-only | open dialog / menu over a live Doc | open and close repeatedly | [judgment: no visible Google content behind dashboard overlays, acceptable flicker] |
| M7 | Subframe hosts | exploratory | — | manual-only | Doc with comments, images, charts, add-ons; Sheet with charts | use features, watch `fenced-dropped` | no needed feature broken; any dropped needed host → `SHIP_IT_BLOCKED.md` (S2) |

## Coverage summary

- Requirements covered: 26/26 (google-docs-pane 20, editor-pane-plugin-tabs 3, internal-monaco-editor-pane 1, dashboard-shell-slots 1, electron-shell 1), plus the S2 spike checks in M-rows
- Scenarios by class: edge 41 · perf 0 (hard gate: convergence only, see X5) · frontend 14 · error 6 · manual 7
- Scenarios by level: L1 48 · L3 5 · electron 8 · manual 7
- Scenarios by disposition: automated 61 · manual-only 7

## New infra needed

- **Fake-Google electron harness** (`tests/e2e-electron/`): a local HTTPS fake for `docs.google.com`, `accounts.google.com`, `drive.google.com` and the off-list test hosts; Chromium `--host-resolver-rules` mapping and a test CA trusted only by the harness launch (never in a packaged default path). A test-only launch flag must be refused unless the harness env is set. Used by F3, F9–F14 and X5.
- **Fake Electron objects** for L1 view-manager tests (recording `WebContentsView` / `webContents` / `session` with emitters and a controllable clock), in `packages/electron/src/__tests__/` support.
