# craft-web-plugin — ArtCraft web editors in the editor pane

Package: `@blackbelt-technology/pi-dashboard-craft-web-plugin` (`packages/craft-web-plugin`). Change: `edit-office-in-pane-with-craft-web` (design D1–D5).
Source of truth: `packages/craft-web-plugin/README.md`, `packages/craft-web-plugin/src/**/AGENTS.md`, `openspec/changes/edit-office-in-pane-with-craft-web/design.md`.

## 1. What / why

- Adds **Edit in WordCraft** (`.docx`) mode to editor-pane file tabs. GridCraft (`.xlsx`), DeckCraft (`.pptx`) claims added only after their spike passes.
- Runs ArtCraft web build (Trunk/eframe wasm) in a sandboxed iframe inside the pane.
- Saves go only through core `POST /api/file/write-binary`. Frame never writes files.
- Depends on: `editor-pane-file-handler` slot + write-binary (`add-editor-pane-file-handlers`), `ctx.serveApp` + `ctx.dataDir` (`add-plugin-capability-routes`), `craft-apps` `provisionWeb`.

## 2. Enabling

- `defaultEnabled: false`. Opt-in.
- Per-app switch: `plugins["craft-web"].apps.<app>.enabled` (default `true`). Schema `configSchema.json`.
- Per-app channel: `plugins["craft-web"].apps.<app>.version`: `"pinned"` (default) | `"latest"`. Env `<APP>_WEB_VERSION=latest` overrides config.
- Read live by status, prepare, validator `enabled()`.
- Plugin enable/disable applies on restart for server entry. Client claims disable live.
- Harness (`docker/`, `tests/e2e/`) seeds the plugin enabled.
- Ship gate: claim added to manifest only when registry `webVersion` set (spike passed).

## 3. Provisioning

- `POST /api/plugins/craft-web/prepare/:app` (tier `control`, single-flight). Never triggered by static GET.
- Downloads pinned `<app>-web-<ver>.zip`, checksum-verified. Installs to `~/.pi/dashboard/plugin-data/craft-web/<app>-web/`.
- Post-install (`src/server/post-install.ts`, passed as `postInstall`):
  1. move inline Trunk bootstrap → `bootstrap-<hash>.js` (`type="module"`);
  2. copy shim → `craft-shim-<hash>.js`, classic `<script>` before bootstrap;
  3. marker `<!-- craft-shim:<shimVersion> -->` (idempotent);
  4. `.gz` siblings for `.wasm .js .html .css` (no `.br`);
  5. `craft-build.json {app, version, shimVersion, sizeGzip}`.
- Result: no inline script. CSP needs no hash. Non-`index.html` assets content-hashed (immutable caching).
- Shim version: `const SHIM_VERSION = <n>;` in `src/shim/craft-shim.js`. Bump on any behaviour change.
- Shim drift: `current` with other `shimVersion` → status `shim-outdated`. Host loads no frame until prepare.
- Overrides: `<APP>_WEB_DIR` (copy), `<APP>_WEB_VERSION` (pin or `latest`). `CRAFT_SOURCE=launcher` never downloads. Details: [`craft-apps.md` §3b](craft-apps.md).

### Status reasons

`GET /api/plugins/craft-web/status` → per app `status: ok | <reason>`:

| reason | meaning | HTTP (prepare) |
|---|---|---|
| `disabled` | app switch off | 403 |
| `restart-required` | enabled live, server entry not loaded | 409 |
| `not-verified` | no `webVersion`, no pin/dir | 409 |
| `not-prepared` | no `current` tree | — |
| `shim-outdated` | `current` shimVersion ≠ plugin | — |
| `offline` | GitHub unreachable | 503 |
| `checksum-mismatch` | SHA256 mismatch | 502 |
| `launcher-source` | `CRAFT_SOURCE=launcher`, no dir | 409 |
| `extract-failed` | zip guard / no index.html | 502 |

### Latest channel

- Status rows carry `channel`.
- `latest` channel: `status` fires single-flight background `latestWebVersion` (metadata GET only, 24 h cache). Never downloads. Prepare still only via `POST .../prepare/:app`.
- Known latest ≠ prepared → `not-prepared` with latest `version`. Download gate = update.
- Failed update + valid prepared build → `ok` (old build kept).
- Latest builds not shim-verified. Bad bootstrap → `extract-failed`; `current` unchanged.
- Rollback: `version: "pinned"`.

### Settings section

- Claim `settings-section` `CraftWebSettings`, lazy `./src/client/CraftWebSettings.tsx`, tab `general`. Route `/settings/plugins/craft-web`.
- Per app (status apps ∩ `CRAFT_WEB_APPS`; fallback `CLAIMED_WEB_APP_IDS` when status unavailable): `SettingsGroup` + status pill (Installed / Update available / Not downloaded / Disabled / Restart required / Failed: <reason> / Unavailable).
- `ToggleField` → `apps.<app>.enabled`. `SelectField` → `apps.<app>.version` (`pinned` "Verified (recommended)" / `latest` "Latest release").
- Edits buffer as draft → host Save Bar (`useSettingsDraftSource({id:"plugin:craft-web"})`).
- Commit sends full config via `plugin_config_write`. Unknown keys round-trip.
- Dirty compares effective values. Absent key ≡ default.
- `SettingsFacts`: Installed version; Latest release (latest channel; "Not checked yet" before first lookup).
- Download / `Update to <version>` button: shown only when status preparable.
- Button → immediate `POST /api/plugins/craft-web/prepare/:app`.
- Button disabled while draft dirty (prepare uses SAVED channel) or running.
- Status refetched after prepare. Failure → error notice with reason.
- Status rows feed UI: `channel`, `installedVersion`, `latestVersion` (latest channel, enabled apps).
- Status 404 → restart notice. Unreachable → error notice. Both offer retry. Form stays editable.

## 4. Routes

| Route | Tier | Notes |
|---|---|---|
| `GET /api/plugins/craft-web/status` | `observe` | per-app status, version, size |
| `POST /api/plugins/craft-web/prepare/:app` | `control` | single-flight; refuses disabled app |
| `POST /api/plugins/craft-web/csp-report` | `control` | body `{app, directive}` ≤ 2 KiB; rate-limited log, counts only |
| `GET /apps/craft-<app>/` | none (trusted mount) | `serveApp` mount; 503 until prepared |
| `POST /api/file/write-binary` | `control` | core route; see [`plugin-seams.md`](plugin-seams.md) |

Tiers in `packages/shared/src/route-tiers.ts`.

## 5. Sandbox model

- Iframe `src=/apps/craft-<app>/index.html[?webgl]#n=<nonce>`.
- `sandbox="allow-scripts"`. **No** `allow-same-origin` → opaque origin: no cookies, no storage of dashboard origin, no dashboard API credentials.
- **No** `allow-downloads`. Every save/export goes through host, which synthesizes device downloads from its own origin. Do not add it to "fix" exports.
- `allow="clipboard-write"`. Paste uses native `paste` events, no clipboard-read permission.
- Per-mount nonce, unique per iframe load.
- Capability probe before iframe: `navigator.gpu` → no flag; else WebGL2 offscreen test → `?webgl`; neither → "this browser cannot run <App>", no iframe.

### CSP (per request, enforced)

```
default-src 'none'
script-src <mount base> 'wasm-unsafe-eval'
style-src 'unsafe-inline'
img-src blob: data:
font-src blob: data:
worker-src blob:
connect-src <mount base> blob:
form-action 'none'
base-uri 'none'
frame-ancestors 'self'
```

- `<mount base>` = `<public origin>/apps/craft-<app>/`, from forwarded-aware public origin. `'self'` unused (opaque origin matches nothing).
- Mount base excludes `/api/*` from `connect-src`: fetch/XHR to dashboard API blocked by policy.
- CSP violations → `csp{nonce, directive}` → host → `POST csp-report`. Shown to user: nothing.
- `<link rel=icon>` refused by `img-src` (harmless, reported once).

## 6. Shim protocol

Shim (`src/shim/craft-shim.js`) runs inside frame. Host accepts only `event.source === iframe.contentWindow` + matching nonce + known type + `bytes ≤ claim.maxBytes`.

Shim → host (`window.parent.postMessage(msg, "*", transfer)`):

| Message | Sent when | Payload |
|---|---|---|
| `ready{nonce}` | after `TrunkApplicationStarted`, canvas present, one animation frame | host waits ≤ 60 s, else "could not start" + Retry (Retry after WebGPU failure uses `?webgl`) |
| `opened{nonce, title}` | title signal first names delivered document | timeout 15 s → "could not open" |
| `save{nonce, suggestedName, mime, bytes}` | stubbed `showSaveFilePicker` `close()`, or anchor-download interception | `bytes` transferred |
| `dirty{nonce, value}` | title `•` signal + input tracking | see Dirty below |
| `blocked{nonce, what}` | refused open: `file-input`, `showOpenFilePicker`, `showDirectoryPicker`, `drop-files`, `paste-files` | host toast "Open other files from the dashboard" |
| `csp{nonce, directive}` | `securitypolicyviolation` | logged server-side |
| `navigate-blocked{nonce, url}` | link click / `window.open` cancelled | host offers new browser tab after confirm |

Host → shim (`targetOrigin "*"`, only value that reaches opaque origin; nonce + `event.source` are the gate):

| Message | When |
|---|---|
| `open{nonce, name, bytes}` | once, in reply to first `ready` |
| `save-result{nonce, ok, error?}` | `ok:false` → stub rejects `AbortError`. No id: FIFO settles pending saves |

Nonce binds messages to mount. It does not authenticate the framed app (which can read it). Write safety: core + validator.

### Shim behaviours

- **Save.** `showSaveFilePicker` → `createWritable` buffers; posts on `close()`. Anchor download: capture-phase `click` + prototype `click`; `fetch(href)` called synchronously inside click handler. `createObjectURL` not wrapped.
- **Open refusal.** `type=file` `click`/`showPicker`, `showOpenFilePicker` (`AbortError`), trusted `drop` with files, `paste` with file items (capture on `window`). Text and image *content* paste allowed.
- **Drop timing.** Drop right after `ready` ignored by WordCraft. Shim delivers synthetic drop after first viewport-title signal (+2 frames +250 ms), or after 3 s without one.
- **Navigation.** Capture-phase `click` on navigating `<a href>`, `HTMLAnchorElement.prototype.click`, `window.open`. Navigation API `navigate` listener kept as defence in depth only (not delivered to opaque frame).
- **WebRTC.** Shim deletes `RTCPeerConnection`, `webkitRTCPeerConnection`, `RTCDataChannel`, `RTCRtpSender` from `window` before app load.

## 7. Dirty derivation

- Signal: eframe `console.warn` `Unhandled egui viewport command: Title("report • - WordCraft")`. `•` = dirty.
- Combined with input tracking on frame's own `window`: any trusted `keydown`/`paste`/`cut`/`drop`, or `pointerdown` followed by title change.
- Any input after last clean signal → `true`.
- "Clean" only when latest title signal clean **and** no input followed.
- After **copy** save: host keeps reporting `true` (tab's file still lacks edits).
- Host: `setDirty("unknown")` until first `dirty`. No `dirty` within 10 s of `opened` → stays `"unknown"` (never evicted, always confirms).

## 8. Save mapping

- `suggestedName` stem ≠ tab stem (both lower-cased, Unicode NFC) → dialog: "<App> wants to save as <name>": **Save as copy next to <file>** / **Overwrite <file>** / **Cancel**.
- Same stem + same extension → `props.save(bytes, {target: saveTarget})`. `saveTarget` = host toolbar toggle `overwrite` (default) | `copy`. Toggle keyed by `cwd+path`.
- Other extension → device download from host origin. Never workspace write.
- Bytes > `claim.maxBytes` → `save-result ok:false`, explain limit, offer device download of the bytes.
- Result → `save-result`.
- Copy save: toast with "Open"; instance stays bound to original file.

## 9. Validator

`ctx.registerFileValidator` per claim (`src/server/ooxml-validator.mjs`, worker-safe):

- Container: `yauzl` central directory only; ≤ 10,000 entries.
- `[Content_Types].xml` ≤ 1 MB. Reject `<!DOCTYPE` / `<!ENTITY`. Bounded attribute scan of `<Override PartName ContentType>` (no XML parser).
- Must declare main-part content type:
  - docx: `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`
  - xlsx: `…spreadsheetml.sheet.main+xml`
  - pptx: `…presentationml.presentation.main+xml`
- That `PartName` must exist in zip.
- App enabled (server-side `enabled()` switch, live).
- Reject → core 422. Saved bytes re-enter Preview as untrusted files.

## 10. Dimensions and limits

| Item | Value |
|---|---|
| WordCraft `maxBytes` | docx office cap 40 MB |
| Release zip | `wordcraft-web-<ver>.zip` ~16 MB gzip, 42 MB wasm |
| `firstOverwriteNotice` | registry `webFidelityNote` ≤ 300 chars |
| Zip guard | ≤ 2000 entries, ≤ 512 MiB uncompressed (`craft-apps`) |
| Keep-alive | `keepAlive.max` 3 (core cap) |

## 11. Spike result — WordCraft 0.8.0 (task 1.1)

Run: docker harness, headless Chromium, `sandbox="allow-scripts"`, production CSP, `http://localhost`. `wordcraft-web-0.8.0.zip` from GitHub release, checksum-verified. **Pass on Chromium. `webVersion = "0.8.0"`.** Evidence: `tests/e2e/craft-web-editor.spec.ts` F1–F9, X7.

| Item | Result |
|---|---|
| `ready` after init, drop-open, `opened` title | pass. `Title("report - WordCraft")` follows drop |
| `showSaveFilePicker` save, Cmd/Ctrl+S, dirty round-trip, copy save, device-download export (PDF), foreign-open refusal | pass (F2, F3, F4, F8) |
| CSP token set; fetch/XHR to example.com and `/api/*` rejected; violation reported | pass (F5) |
| WebGPU in sandbox and `?webgl` leg; IndexedDB refused (font store warns) | pass (F9 both legs) |
| Cross-origin loads (CORS-mode module/preload/wasm) | pass with `crossOriginFrame` |
| Firefox + Safari synthetic `DataTransfer` drop | **unverified** — not run |
| zrok tunnel URL | **unverified** — not run |
| P1 first Edit → `opened` (cached build) | 1.9–3.0 s (5 runs, p95 ≈ 3.0 s) |
| P2 cold prepare | ≈ 3 s, 16.0 MB gzip |

Findings that changed design:

1. Release zip wraps site in `wordcraft-web-<ver>/`. `provisionWeb` hoists single top dir holding `index.html`.
2. Drop right after `ready` ignored (see Shim behaviours).
3. Navigation API not delivered to opaque-origin frame (Chromium). Link/`window.open` interception used instead.
4. Plugin activation restart-effective for client too (`/api/health.plugins[]`). Live-disable overlay verified by serving health response; real run needs restart + `plugin-config-update`.
5. Pasting image copied in browser refused when file items present (shim cannot tell content from file). Text paste untouched.

Ship gate for WordCraft also requires per-app Playwright e2e green with production `sandbox="allow-scripts"`, IndexedDB refused, `?webgl` leg.

## 12. Residuals (accepted)

- **`location.href = …` navigation** cannot be intercepted. Malicious bundle could navigate frame to side-effecting `/api/*` GET on loopback (response unreadable; mutations refused). Same class as live-server frames today. Core follow-up (`add-editor-pane-file-handlers` D7) covers both.
- **WebRTC recovery.** Shim removes constructors; a malicious bundle could recover them (nested same-origin frame). Malicious bundle could leak loaded document once via URL.
- **Pinned, checksum-verified open-source bundles** are the trust basis. Spec claims only that fetch, XHR, WebSocket, EventSource blocked by policy.
- **Stale frame after `current` swap.** Frame loaded before prepare may get 404s on lazy fetches → "could not start"/Resume. Content-hashed names, no mixed code.
- **Mount outlives disable.** Public build stays served until restart. Prepare/status/saves refused immediately.
- **Navigation on reload.** Second `ready` / second `load` → host drops frame: "The editor reloaded. Unsaved edits were lost." (when state `true`/`"unknown"`).
- **Shim drift on app update.** Pinned `webVersion`; per-app e2e gates pin bump.
- **Fidelity loss.** Core first-overwrite notice, Save-target toggle, OOXML validator.
- **Lost preferences** (save-target toggle) accepted.

## 13. Tests

- `packages/craft-web-plugin/src/server/__tests__/`: mount, validator, post-install, routes, service, shim-version.
- `packages/craft-web-plugin/src/client/__tests__/`: gate, protocol, save, `CraftWebSettings.test.tsx`.
- `packages/craft-web-plugin/src/shim/__tests__/`: craft-shim.
- `packages/craft-apps/src/__tests__/provision-web.test.ts`: `provisionWeb` (E14b hoist, guards).
- `tests/e2e/craft-web-editor.spec.ts`: F1–F9, X7 (docker harness).

## See also

- [`plugin-seams.md`](plugin-seams.md) — `editor-pane-file-handler` slot, `write-binary`, `serveApp`, `dataDir`.
- [`craft-apps.md`](craft-apps.md) — `provisionWeb`, web-build layout, env.
