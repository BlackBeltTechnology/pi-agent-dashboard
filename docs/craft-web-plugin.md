# craft-web-plugin — ArtCraft web editors in the editor pane

Package: `@blackbelt-technology/pi-dashboard-craft-web-plugin` (`packages/craft-web-plugin`). Changes: `edit-office-in-pane-with-craft-web` (design D1–D5), `extend-craft-web-to-all-apps` (design D1–D11).
Source of truth: `packages/craft-web-plugin/README.md`, `packages/craft-web-plugin/src/**/AGENTS.md`, `packages/craft-web-plugin/src/shared/app-profiles.ts`, `openspec/changes/edit-office-in-pane-with-craft-web/design.md`, `openspec/changes/extend-craft-web-to-all-apps/design.md`.

## 1. What / why

- Adds **Edit in <App>** / **View in <App>** modes to editor-pane file tabs. 10 apps, 1 profile row each. See change: extend-craft-web-to-all-apps.
- Runs ArtCraft web build (Trunk/eframe wasm, or custom loader) in a sandboxed iframe inside the pane.
- Saves go only through core `POST /api/file/write-binary`. Frame never writes files.
- Depends on: `editor-pane-file-handler` slot + write-binary (`add-editor-pane-file-handlers`), `ctx.serveApp` + `ctx.dataDir` (`add-plugin-capability-routes`), `craft-apps` `provisionWeb`.

### App types (D1)

- Type A: saves opened format. Edit claim on own ext.
- Type B: saves native format. Edit claim on native ext + foreign-ext edit claim with `siblingExtensions`.
- Type C: library / external media. Preview claim only.
- Type D: cannot open dropped file. No claim.

### Apps (verified web build, D8)

| App | Version | Claim id | Extensions | Mode | Saves land |
|---|---|---|---|---|---|
| WordCraft | 0.8.0 | `wordcraft` | `.docx` | edit | in place |
| GridCraft | 0.8.0 | `gridcraft` | `.xlsx` | edit | in place |
| PdfCraft | 0.9.0 | `pdfcraft` | `.pdf` | edit | in place (incremental update) |
| CADCraft | 0.8.0 | `cadcraft` | `.dxf` | edit | in place (DXF R2000) |
| DesignCraft | 0.9.0 | `designcraft` | `.designcraft` | edit | in place |
| SoundCraft | 0.8.0 | `soundcraft` | `.scraftz` | edit | in place, named after session (first save asks) |
| PhotoCraft | 0.10.0 | `photocraft` | `.psd` | edit | in place |
| PhotoCraft | 0.10.0 | `photocraft-raster` | `.png .jpg .jpeg .webp .tif .tiff` | edit, sibling `.psd` | new `<stem>.psd` next to file |
| VectorCraft | 0.16.0 | `vectorcraft` | `.svg` | edit, sibling `.vectorcraft` | new `<stem>.vectorcraft` next to file |
| DeckCraft | 0.7.0 | `deckcraft` | `.pptx` | edit, sibling `.deckcraft` | new `<stem>.deckcraft` next to file |
| DeckCraft | 0.7.0 | `deckcraft-native` | `.deckcraft` | edit | in place |
| LightCraft | 0.9.1 | `lightcraft` | `.dng .cr2 .cr3 .nef .arw .raf .orf .rw2` | preview | none (exports download to device) |

Not claimed:
- FilmCraft 0.9.0, EffectCraft 0.11.1: no claim. Media-project spike deferred to `add-craft-web-media-projects`.
- FigCraft 0.7.0: no claim. Ignores dropped `.svg`.

Dropped formats (gate failed, not claimed):
- `.dwg` (CADCraft): web build refuses DWG on open. Save would suggest `.dxf`, device download only.
- `.odt`, `.rtf` (WordCraft): open on drop, but Ctrl+S always writes `.docx`. In-place gate fails. Validators kept in dispatcher, unused.

### Version channels

- `latestChannel: true`: WordCraft only.
- `latestChannel: false`: every other app. Channel fixed to registry `webVersion`.
- DeckCraft fixed `0.7.0`: 0.8.0 panics on start (`std::process::id`), unsandboxed too.

## 2. Enabling

- `defaultEnabled: false`. Opt-in.
- Per-app switch: `plugins["craft-web"].apps.<app>.enabled` (default `true`). Schema `configSchema.json`.
- Per-app channel: `plugins["craft-web"].apps.<app>.version`: `"pinned"` (default) | `"latest"`. Env `<APP>_WEB_VERSION=latest` overrides config.
- `latestChannel:false` app: stored `latest` ignored. Status prepares verified version. Settings shows fixed channel.
- Read live by status, prepare, validator `enabled()`.
- Plugin enable/disable applies on restart for server entry. Client claims disable live.
- Harness (`docker/`, `tests/e2e/`) seeds the plugin enabled.
- Ship gate: claim added to manifest only when registry `webVersion` set (spike passed).

## 3. Provisioning

- `POST /api/plugins/craft-web/prepare/:app` (tier `control`, single-flight). Never triggered by static GET.
- Downloads pinned `<app>-web-<ver>.zip`, checksum-verified. Installs to `~/.pi/dashboard/plugin-data/craft-web/<app>-web/`.
- Zip wraps site in `<app>-web-<ver>/`. `provisionWeb` hoists single top dir holding `index.html`.
- Post-install (`src/server/post-install.ts`, passed as `postInstall`):
  1. Externalizes every executable inline script (no `type`, or `text/javascript` / `module`) → `inline-<n>-<hash>.js`. Keeps kind and order.
  2. Data blocks (`application/json`, `text/template`, …) stay inline. CSP does not apply to them.
  3. Inline `importmap` → prepare fails. CSP would block it; no observed build uses one.
  4. Inline event-handler attrs and `javascript:` URLs stay unsupported. CSP blocks them at runtime.
  5. Injects ready hook (profile `ready`):
     - `trunk`: build's own `TrunkApplicationStarted` dispatch.
     - `load-ready-ms`: dispatch right after `window.<global>.readyMs = …`.
     - `after-start-call`: dispatch right after the matched `<call>(` statement.
  6. Hook point must match **exactly once**. Else throw → `extract-failed`, `current` unchanged.
  7. Writes `craft-worker-<hash>.js` (only `workerTrampoline` profiles, loaded first).
  8. Writes `craft-profile-<hash>.js` (`window.__CRAFT_PROFILE__ = {…}`), loaded before shim.
  9. Copies shim → `craft-shim-<hash>.js`, classic `<script>` before bootstrap.
  10. Markers: `<!-- craft-shim:<v> -->` (idempotent) + `<!-- craft-profile:<hash> -->`.
  11. `.gz` siblings for `.wasm .js .html .css` (no `.br`).
  12. `craft-build.json {app, version, shimVersion, profileHash, sizeGzip}`.
- `profileHash` = hash of frame profile + `ready` + `workerTrampoline`. Changed profile → `shim-outdated`.
- Result: no inline script. CSP needs no hash. Non-`index.html` assets content-hashed (immutable caching).
- Shim version: `const SHIM_VERSION = 3;` in `src/shim/craft-shim.js`. Bump on any behaviour change.
- Shim compat (`shimCompat`, D8):
  - build shim > plugin shim → `shim-outdated`.
  - build shim < `minShimVersion` → `shim-outdated`.
  - build shim < plugin shim (≥ `minShimVersion`) → `ok` + `shimUpdate: true` (Update offered).
  - same shim, `profileHash` ≠ profile → `shim-outdated`.
- `minShimVersion`: WordCraft `1` (installed builds keep loading). New apps `2`.
- Stale trees: prepare drops trees of current shim with other profile hash (cache key `<version>-s<shim>`).
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
| `shim-outdated` | `current` shim/profile incompatible (see compat above) | — |
| `offline` | GitHub unreachable | 503 |
| `checksum-mismatch` | SHA256 mismatch | 502 |
| `launcher-source` | `CRAFT_SOURCE=launcher`, no dir | 409 |
| `extract-failed` | zip guard / no index.html / hook not exactly once | 502 |

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
- Groups by app kind (G2):
  - "Edit files in place": edit claims without sibling.
  - "Save in their own format, next to the file": claims with `siblingExtensions`.
  - "View only": preview claims.
- Group header lists app extensions (e.g. `.pptx → .deckcraft`).
- `ToggleField` → `apps.<app>.enabled`.
- `SelectField` → `apps.<app>.version` (`pinned` "Verified (recommended)" / `latest` "Latest release"). Only for `latestChannel:true` apps.
- `latestChannel:false` → no selector. Read-only fact `Verified <v>` + reason hint:
  - DeckCraft: "Newer web builds fail to start."
  - others: "Newer releases are used once they are verified with this dashboard."
- Edits buffer as draft → host Save Bar (`useSettingsDraftSource({id:"plugin:craft-web"})`).
- Commit sends full config via `plugin_config_write`. Unknown keys round-trip.
- Dirty compares effective values. Absent key ≡ default.
- `SettingsFacts`: Installed version; Latest release (latest channel; "Not checked yet" before first lookup).
- Download button: `Download <App> (about <size>)`. `shimUpdate` → `Update <App>`. Shown only when status preparable or `shimUpdate`.
- Button → immediate `POST /api/plugins/craft-web/prepare/:app`.
- Button disabled while draft dirty (prepare uses SAVED channel) or running.
- Status refetched after prepare. Failure → error notice with reason.
- Status rows feed UI: `channel`, `installedVersion`, `latestVersion` (latest channel, enabled apps), `shimUpdate`.
- Status 404 → restart notice. Unreachable → error notice. Both offer retry. Form stays editable.

## 4. Routes

| Route | Tier | Notes |
|---|---|---|
| `GET /api/plugins/craft-web/status` | `observe` | per-app status, version, size, channel, shimUpdate |
| `POST /api/plugins/craft-web/prepare/:app` | `control` | single-flight; refuses disabled app |
| `POST /api/plugins/craft-web/csp-report` | `control` | body `{app, directive}` ≤ 2 KiB; rate-limited log, counts only |
| `POST /api/plugins/craft-web/telemetry` | `control` | body ≤ 1 KiB; counts + rate-limited log, no paths. See change: extend-craft-web-to-all-apps (D4) |
| `GET /apps/craft-<app>/` | none (trusted mount) | `serveApp` mount; 503 until prepared |
| `POST /api/file/write-binary` | `control` | core route; see [`plugin-seams.md`](plugin-seams.md) |

Telemetry body:
- `{app, kind:"open", outcome}`; `outcome` ∈ `title | fallback | timeout | start-failed`.
- `{app, kind:"reject", ext}`; `ext` matches `^\.[a-z0-9]{1,15}$`.
- Invalid body / unknown app → 400 `invalid-report`.
- Rate-limited → 429 `rate-limited`.

Log lines (`service.reportTelemetry`):
- `telemetry <app> open outcome=<o> total=<n>` (`title`/`fallback` at info, `timeout`/`start-failed` at warn).
- `telemetry <app> validator-reject ext=<e> total=<n>` (warn).

Tiers in `packages/shared/src/route-tiers.ts`.

## 5. Sandbox model

- Iframe `src=/apps/craft-<app>/index.html[?<frameParams>&webgl]#n=<nonce>`.
- `frameParams`: URL query flags only, from profile (e.g. `nosw`: app skips `navigator.serviceWorker`). Never permissions.
- `sandbox="allow-scripts"`. Unchanged. **No** `allow-same-origin` → opaque origin: no cookies, no storage of dashboard origin, no dashboard API credentials.
- **No** `allow-downloads`. Every save/export goes through host, which synthesizes device downloads from its own origin. Do not add it to "fix" exports.
- `allow="clipboard-write"`. Unchanged. Paste uses native `paste` events, no clipboard-read permission.
- Per-mount nonce, unique per iframe load.
- Capability probe before iframe: `navigator.gpu` → no flag; else WebGL2 offscreen test → `?webgl`; neither → "this browser cannot run <App>", no iframe.
- Worker trampoline (D5, `workerTrampoline` profiles only):
  - wraps `window.Worker`. http(s) URL → `blob:` bootstrap.
  - bootstrap body: one `import <abs URL>;` (module) or `importScripts(…)` (classic).
  - `blob:`/`data:` pass through. `SharedWorker` not wrapped.
  - CSP inherited by `blob:` worker: `script-src` limits import to mount base. Browser-asserted; e2e scenario "Worker script outside the build refused".
  - No new origin, credential or storage reach.
- Service workers unavailable. Apps that register one get `nosw` via `frameParams`.

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

Shim (`src/shim/craft-shim.js`, v3) runs inside frame. Profile from `window.__CRAFT_PROFILE__`; no profile → v1 title rule. Host accepts only `event.source === iframe.contentWindow` + matching nonce + known type + `bytes ≤ claim.maxBytes`.

Shim → host (`window.parent.postMessage(msg, "*", transfer)`):

| Message | Sent when | Payload |
|---|---|---|
| `ready{nonce}` (v3: + `shimVersion`, `control` = profile has `control` entry) | after `TrunkApplicationStarted` (or profile hook), canvas present, one animation frame | host waits ≤ 60 s, else "could not start" + Retry (Retry after WebGPU failure uses `?webgl`) |
| `opened{nonce, title, confirmed?}` | title profile: title names delivered document. No-title profile: `openedFallbackMs` after drop, `confirmed:false` | timeout 15 s → "could not open". Absent `confirmed` = v1 = confirmed |
| `start-failed{nonce, detail?}` | before opened: window `error`/`unhandledrejection` (RuntimeError, `unreachable`), `console.error` `panicked at` | host "could not start" + Retry; no resend |
| `save{nonce, suggestedName, mime, bytes}` (v3: + `msSinceInput` = ms since last trusted input; `1e9` if none) | stubbed `showSaveFilePicker` `close()`, or anchor-download interception | `bytes` transferred |
| `dirty{nonce, value}` | title dirty marker + input tracking | see Dirty below |
| `blocked{nonce, what}` | refused open: `file-input`, `showOpenFilePicker`, `showDirectoryPicker`, `drop-files`, `paste-files` | host toast "Open other files from the dashboard" |
| `csp{nonce, directive}` | `securitypolicyviolation` | logged server-side |
| `navigate-blocked{nonce, url}` | link click / `window.open` cancelled | host offers new browser tab after confirm |
| `control-result{nonce, id, ok, result?, error?, code?}` | answer to host `control` | `code` = `not-ready` \| `unsupported` from shim itself; other replies relayed from page API |

Host → shim (`targetOrigin "*"`, only value that reaches opaque origin; nonce + `event.source` are the gate):

| Message | When |
|---|---|
| `open{nonce, name, bytes}` | once, in reply to first `ready` |
| `save-result{nonce, ok, error?, own?}` | `ok:false` → stub rejects `AbortError`. `own:true` = own-file overwrite acked (drives `cleanOnAckedSave`). No id: FIFO settles pending saves |
| `control{nonce, id, method, params?}` | relayed to app page API per `profile.control`: `page-api` → `window[global].request(method, params)`; `page-command` → only `engine.execute{command, params?}` as `window[global].command(command, JSON text)`, reply `JSON.parse`'d. Global absent after `opened` waits 2 s, then `unsupported` |

Nonce binds messages to mount. It does not authenticate the framed app (which can read it). Write safety: core + validator.

### Shim behaviours

- **Title signal.** Profile `title.pattern`: anchored regex, capture 1 = document name, `dirtyMarker` stripped. Em dash accepted (`—`), with `-` and `–`. Example PhotoCraft `^(.*) [-–—] PhotoCraft$`.
- **Opened fallback.** No `title` profile: titles only tick the drop. `opened{confirmed:false}` + `dirty:false` after `openedFallbackMs` if canvas still in DOM, no start error, no `pagehide`.
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
- `cleanOnAckedSave: true` (all apps but WordCraft): `save-result{ok:true, own:true}` with no trusted input since the save request → clean. Persisting `— Edited` (GridCraft) does not re-raise dirty; a title **change** does.
- `cleanOnAckedSave: false` (WordCraft): title-driven rule as before.
- Fallback-opened instances: `dirty:false` at open.
- Preview claim: host ignores `dirty`, `setDirty(false)` once opened.
- After **copy** save: host keeps reporting `true` (tab's file still lacks edits).
- Sibling save: tab stays dirty.
- Host: `setDirty("unknown")` until first `dirty`. No `dirty` within 10 s of `opened` → stays `"unknown"` (never evicted, always confirms).

## 8. Save mapping

`routeSave` order (`src/client/save-routing.ts`):

1. Preview claim → device download (any name).
2. Suggested ext declared in `siblingExtensions` → `sibling`. Over `maxBytes` → `too-large`.
3. Other ext → device download. Never workspace write.
4. Over claim `maxBytes` → `too-large` → `save-result ok:false` + download offer.
5. `saveName: "inner-title"` → `save-as` until name answered in this instance; then `own`.
6. Same stem (NFC, lower-case) → `own` → `props.save(bytes, {target: saveTarget})`. Other stem → `save-as`.

Save-as dialog (existing): "<App> wants to save as <name>": **Save as copy next to <file>** / **Overwrite <file>** / **Cancel**. `inner-title` adds "<App> names saves after the session inside the file, not after <file>."

- `saveTarget` = host toolbar toggle `overwrite` (default) | `copy`. Toggle keyed by `cwd+path`.
- Copy save: toast with "Open"; instance stays bound to original file.
- Core turns overwrite into copy → written path base name ≠ tab → not own (`save-result` without `own`).

Sibling save (D6):
- Core: `POST /api/file/write-binary?mode=copy&siblingExt=<.ext>` (no `expectSha1`). Target `<stem>.<ext>`, then `<stem>-<n>.<ext>` (n ≤ 99, `wx`). Same authz, lock, size and validator rules.
- Dialog `craft-sibling`: title "<App> saves as <ext>" + reason line. Target named by tab stem (`photo.psd`, not app's typed name).
  - **Create and open**: primary. Hidden (not disabled) when native claim unavailable. Opens new tab via host `openFile(path, nativeClaimId)`.
  - **Create**.
  - **Download instead**.
  - **Cancel**.
- Exhausted (99 copies, `conflict-unresolved`): alert `craft-sibling-exhausted`, text "too many copies" + "Open <stem><ext> in <App> to keep editing it in place" + Download instead.
- Old runtime without `siblingExtensions` / `openFile`: claim field dropped; native saves → device download; "Create and open" hidden.

Toolbar (D11 B2/B3):
- Edit claim with siblings: chip `craft-sibling-chip` "Save (Ctrl+S) creates <stem><ext>". Save-target label "Exports to <ext>".
- Preview claim: chip `craft-preview-chip` "View only. Exports download to this device". No save target.
- Selected save-target button: `--text-primary` on `--accent-soft` (contrast fix; `--accent-text` measured 4.49:1, below AA 4.5:1).

Binary notice (D11 A4, core `BinaryWarn`): when enabled claims match file, notice adds one button per matching mode (switcher label + action). Covers `.psd .designcraft .scraftz .dng .dwg` with no built-in viewer.

## 9. Validators

- One dispatcher `src/server/validators/index.mjs` registered **per edit claim** (`claimId` = app id; `ctx.registerFileValidator`). Worker-safe, plain ESM, node built-ins only.
- `validate(bytes, ext)`: routes on `ext`, rejects unknown `ext` and empty bytes. Claim membership enforced by core before validator runs.
- Reject-only, bounded. Text reads ≤ 1 MiB head + 4 KiB tail (`text-window.mjs`); SVG full scan (16 MiB cap).
- Zip: central directory only (`zip.mjs`, ≤ 10 000 entries, no zip64/multi-disk). No entity-expanding parser. No XML parsed.
- Reject → core 422. Saved bytes re-enter Preview as untrusted files.

| Ext | Check (file) |
|---|---|
| `.docx .xlsx .pptx` | OOXML: `[Content_Types].xml` main-part type + `PartName` in zip, ≤ 1 MB, no `<!DOCTYPE`/`<!ENTITY` (`ooxml.mjs`) |
| `.odt` | first member STORED `mimetype` = `application/vnd.oasis.opendocument.text`, `content.xml` present (`odf-text.mjs`). Unused: `.odt` claim dropped |
| `.rtf` | `{\rtf1` at offset 0 (`rtf.mjs`). Unused |
| `.pdf` | `%PDF-1.[0-7]` / `2.0` in first 1 KiB, `%%EOF` in last 2 KiB (`pdf.mjs`) |
| `.dxf` | binary sentinel `AutoCAD Binary DXF\r\n\x1a\0`; ASCII: first non-`999` pair `0/SECTION`, tail `0/EOF` (`dxf.mjs`) |
| `.dwg` | `AC10xx` at offset 0, R13–R2018 set (`dwg.mjs`). Unused: claim dropped |
| `.designcraft` | zip; `mimetype` = `application/vnd.designcraft+zip`; `document.json` present (`zip-members.mjs`) |
| `.scraftz` | zip; exactly one top-level `*.scraft`; `Audio Files/` optional |
| `.deckcraft` | zip; `mimetype` = `application/vnd.storyteller.deckcraft+zip`; `presentation.json` present |
| `.psd` | `8BPS` + version 1 (PSD) or 2 (PSB), ≥ 26 bytes (`psd.mjs`) |
| `.png .jpg .jpeg .webp .tif .tiff` | own signature per ext; PNG bytes fail `.jpg` (`raster.mjs`) |
| `.svg` | bounded tokenizer (`svg.mjs`). Reject `<!DOCTYPE`/`<!ENTITY`; root `svg`; elements `script foreignObject iframe embed object handler`; `on*` attrs; SMIL `set`/`animate*` on `on*`/`href`; `javascript:` `vbscript:` `data:text/html` in URL attrs (after char-ref decode, whitespace/control strip) |
| `.vectorcraft` | JSON text: leading `"format": "vectorcraft"` + `"version": <n>` within 4 KiB, ends `}` (`vectorcraft.mjs`). No JSON parse |

- SVG filter reason: `/api/file/raw` serves `.svg` inline (`packages/server/src/routes/file-routes.ts:1196-1201`) under report-only CSP (`packages/server/src/auth/csp.ts:6-10`). Script-bearing SVG must not reach disk. Inline-SVG raw route hardening = follow-up task 6.3.
- Polyglots that pass are accepted (trade-off). Saved files re-enter previews as untrusted (SVG via `<img>`, `packages/client/src/components/preview/ImagePreview.tsx:28`, scripts never run).

## 10. Dimensions and limits

| Item | Value |
|---|---|
| `capForExtension` `.docx .odt .rtf` | `OFFICE_SIZE_CAPS.docx` (40 MB) |
| `capForExtension` `.xlsx` | `OFFICE_SIZE_CAPS.sheet` |
| `capForExtension` `.pptx` | `OFFICE_SIZE_CAPS.pptx` |
| `capForExtension` `.svg` | `SVG_MAX_BYTES` = 16 MiB |
| `capForExtension` other | `HANDLER_MAX_BYTES` |
| Claim `maxBytes` | min of its extensions' caps (`capFor`) |
| Release zip | `wordcraft-web-<ver>.zip` ~16 MB gzip, 42 MB wasm |
| `firstOverwriteNotice` | registry `webFidelityNote` ≤ 300 chars. Unconfirmed-open profiles prepend the check sentence (D4) |
| Zip guard | ≤ 2000 entries, ≤ 512 MiB uncompressed (`craft-apps`) |
| Keep-alive | `keepAlive.max` 3 (core cap) |
| Frame timeouts | ready 60 s, opened 15 s (`READY_TIMEOUT_MS`, `OPENED_TIMEOUT_MS`) |
| `openedFallbackMs` | 1000–15000 ms (drift test). Required iff no `title` |
| CSP report | ≤ 2 KiB body; 1/directive/10 s, max 20 (client) |

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
- **Unconfirmed opens** (no title profile). User check line in first-overwrite notice + validators + telemetry `fallback` count.
- **Worker trampoline breaks app** deriving URLs from `self.location` in worker. Per-profile flag, off by default.
- **Lost preferences** (save-target toggle) accepted.
- **Sibling accumulation.** Bounded at 99 copies. Mitigated by "Create and open".
- **Polyglot validator pass.** Accepted.
- **Downgrade offline.** Plugin downgrade → `shimVersion 2 ≠ 1` → `shim-outdated` → re-prepare needs network.

## 13. Tests

- `packages/craft-web-plugin/src/server/__tests__/`: mount, validator, post-install, routes, service, shim-version.
- `packages/craft-web-plugin/src/client/__tests__/`: gate, protocol, save, `CraftWebSettings.test.tsx`, `i18n.test.ts` (EN/zh-CN/hu parity).
- `packages/craft-web-plugin/src/shim/__tests__/`: craft-shim (E8–E11 v2), craft-worker (E26, X5).
- `packages/craft-web-plugin/src/__tests__/manifest.test.ts`: drift. Profiles ↔ manifest claims ↔ registry `webVersion` ↔ validator routes; `copySuffix` = appId; `maxBytes` ≤ `HANDLER_MAX_BYTES`; notice ≤ 300 chars; unconfirmed-open check sentence present.
- `packages/craft-apps/src/__tests__/provision-web.test.ts`: `provisionWeb` (E14b hoist, guards).
- `tests/e2e/craft-web-editor.spec.ts`: table-driven over profiles. F1 (open), F2 (save in place or sibling), F3 (dirty), F5 (CSP), F9 (WebGPU/`?webgl`), X7. Fixtures: `docker/fixtures/sample-git/craft/`.

## 14. Extension spikes per app (Waves 1–4)

Harness `/tmp/craftweb-spike/` (not committed). Real `createPostInstall`, production `buildCsp`, `sandbox="allow-scripts"`, stub host, headless Chromium `?webgl`.

### 14.1 Spike table (Wave 1)

| App (web ver) | Loader | Opens on drop | Ctrl+S produced | Title signal | Type |
|---|---|---|---|---|---|
| WordCraft 0.8.0 | Trunk | `.docx` | `.docx` in place | `name • - WordCraft` | A (shipped) |
| GridCraft 0.8.0 | Trunk | `.xlsx` | `.xlsx` in place | `name — Edited`; stays after picker save | A |
| PdfCraft 0.9.0 | Trunk | `.pdf` | `.pdf` in place | none | A |
| CADCraft 0.8.0 | Trunk | `.dxf` (R12) | `.dxf` (R2000) | none | A |
| DesignCraft 0.9.0 | Trunk | `.designcraft` | same name, assets embedded | none | A |
| SoundCraft 0.8.0 | Trunk + 2nd inline script | `.scraftz` | `<session name>.scraftz` | none | A (session-name save) |
| PhotoCraft 0.10.0 | Trunk | `.jpg` | `.psd` | `name — PhotoCraft` | B |
| VectorCraft 0.16.0 | Trunk | `.svg` | in-app Save As, default `.vectorcraft` | `name — VectorCraft` | B |
| DeckCraft 0.8.0 / 0.7.0 | Trunk | 0.8.0 panics on start; 0.7.0 opens `.pptx` | `.deckcraft` (zip) | none | B (pin 0.7.0) |
| LightCraft 0.9.1 | custom, `start(font)` | `.jpg` into demo library | nothing (non-destructive) | `LightCraft` | C |
| FilmCraft 0.9.0 | custom, `filmcraftLoad.readyMs`; 2nd inline | media into demo project | `<project>.fcproj` | none | C (deferred) |
| EffectCraft 0.11.1 | custom, `effectcraftLoad.readyMs`; SW; module workers | media into demo project | `<project>.ecproj` | `EffectCraft - name *` | C (deferred) |
| FigCraft 0.7.0 | Trunk | ignores dropped `.svg` | not reached | none | D |

Save capture:
- Stubbed `showSaveFilePicker`: WordCraft, GridCraft, PhotoCraft, VectorCraft.
- Download-link interception: CADCraft, SoundCraft, DesignCraft, PdfCraft, DeckCraft.
- No viewport title: SoundCraft, CADCraft, PdfCraft, DesignCraft, DeckCraft, FilmCraft.

Environment findings:
- `navigator.serviceWorker` access **throws** in opaque-origin sandbox. EffectCraft skips under `?nosw`.
- `new Worker(httpUrl)` from origin `null` fails (same-origin rule, not CSP). Blob bootstrap importing mount URL starts.
- OPFS and IndexedDB refused, as designed; apps log and continue.
- Favicons hit `img-src` (harmless reports).

### 14.2 Wave 1 fixture findings (task 2.3, 2.5)

- `.dwg` (CADCraft 0.8.0): **dropped**. Web build refuses DWG. Fallback `Drawing1`; save suggested `Drawing1.dxf` → device download. Nothing overwritten (D4 accepted cost).
- `.odt` / `.rtf` (WordCraft 0.8.0): **dropped**. Ctrl+S always writes `letter.docx`. Follow-up candidate: type B claim (`.odt .rtf` + sibling `.docx`).
- PdfCraft 0.9.0: incremental save. Added comment appended; original bytes = byte-for-byte prefix. No-edit save writes original bytes. Fidelity note says so.
- GridCraft 0.8.0: `— Edited` persists after picker save; acked own save clears dirty. Workbook without `xl/styles.xml` → blocking dialog; fixture carries one.
- CADCraft `.dxf`, DesignCraft, SoundCraft: fallback open (`confirmed:false`). Dirty after input, clean after acked own save. DesignCraft keeps `assets/`. CADCraft writes DXF R2000.
- SoundCraft opened from file saves under file name (`mix.scraftz`, inner session renamed). `saveName: "inner-title"` kept (extra first question = safe default).

### 14.3 Wave 2 findings (tasks 3.1, 3.7–3.9)

- `.vectorcraft` = JSON (`application/json`). Ctrl+S → VectorCraft Save As (name `shapes.vectorcraft`). SVG choice in format list not exercised; same-extension save would be ordinary own save.
- PhotoCraft 0.10.0: opens `.psd .png .jpg .jpeg .webp .tif .tiff` on drop; always saves `<stem>.psd` (`8BPS` v1). `.psd` reopens and saves in place. All raster exts passed gate.
- DeckCraft 0.7.0: opens `.pptx` and `.deckcraft` (fallback, no title). Saves `<stem>.deckcraft` (`mimetype` + `presentation.json`).
- Create and open needs host `FileHandlerProps.openFile?(path, claimId?)` (additive, optional).

### 14.4 Wave 3 RAW spike (task 4.1) — go

- LightCraft 0.9.1, `after-start-call start(font)` + `workerTrampoline`: prepares and starts under production CSP.
- Dropped CC0 DNG (Sigma fp, 2.1 MB) opens selected in develop view. Demo library visible in filmstrip.
- Opened via fallback (`confirmed:false`) ≈ 10 s after host `open` (3 s drop fallback + decode + 5 s `openedFallbackMs`). Inside 15 s budget, close to it.
- Samsung `.dng` sample = JPEG (`FFD8`). Only real TIFF-based DNGs used.
- Interactive in headless Chromium (SwiftShader); no page-thread stall beyond decode.
- `lightcraft_zh_hans.otf` absent from release → one `ERR_FAILED` logged; app falls back.
- Per-extension samples passed (raw.pixls.us): CR2, CR3, NEF, ARW, RAF, ORF, RW2. ARW/RAF show "Preview only" note (embedded JPEG, unsupported variant). Still a view; extensions kept.

### 14.5 Wave 4 media-project spike (task 5.1) — deferred

- FilmCraft 0.9.0: `load-ready-ms` hook works; several synthetic drops accepted (media → `/files/<name>`); projects reference media only by VFS paths.
- Dropped-project-resolves-media not distinguishable from demo project. OPFS recovery writes fail (logged).
- EffectCraft: `window.effectcraft.addFile` = more direct route.
- No FilmCraft/EffectCraft claim. Follow-up `add-craft-web-media-projects` starts from-scratch project spike.

### 14.6 Observability

- Counters per app and event, log only (no paths): `telemetry <app> open outcome=<o> total=<n>`, `telemetry <app> validator-reject ext=<e> total=<n>`.
- Open outcomes: `title` (title-profile confirmed open), `fallback` (no-title open, `confirmed:false`), `timeout`, `start-failed`.
- `title` vs `fallback` ratio per app = signal that no-title profile is in use.
- Rate-limited per app window; 429 on overflow.
- `csp-report` counts: `csp-report <app> directive=<d> total=<n>`.

### 14.7 Upstream issues

Filed 2026-10-20 (drafts `openspec/changes/extend-craft-web-to-all-apps/upstream-issues.md`):

- Viewport `Title` naming document: pdfcraft#3640, cadcraft#1717, designcraft#1356, soundcraft#809, deckcraft#1058, lightcraft#2397, filmcraft#2579 — `https://github.com/storytold/<app>/issues/<n>`.
- DeckCraft 0.8.0 `process::id` panic: https://github.com/storytold/deckcraft/issues/1059
- FigCraft dropped-file open: https://github.com/storytold/figcraft/issues/916
- Common `window.<app>.request` API: https://github.com/storytold/craft-libs/issues/193
- GridCraft `— Edited` kept after save: https://github.com/storytold/gridcraft/issues/2050

### 14.8 Live control: VectorCraft re-spike (change add-craft-live-control, task 1.1) — go

- Date 2026-10-24. Version `vectorcraft-web` 0.16.0 (newest release). `window.vectorcraft` first in 0.14.0.
- Method: `spike-craft-web-app-in-sandbox`. Real `createPostInstall` (shim v2 tree). Production CSP. `sandbox=allow-scripts`. Playwright (swiftshader). 900x650 frame.
- Decision: GO.
- Title regex `^(.*) [-–—] VectorCraft$` matches `logo.svg — VectorCraft`. Shim title `logo.svg`, `confirmed:true`. No CSP messages.
- Drop-open ok. User click → shim `dirty true`. Save → shim `save` message.
- `window.vectorcraft` keys: `request`, `execute`, `commands`, `inspect`, `screenshot`, `openFile`, `captureDownloads`, `files`, `readFile`.
- `request("ui.inspect")` resolves `{documents:[{dirty,title}], canvasRect, fileDialog, tool, ...}`.
- `request("engine.commands")` → 1121 commands `{id,label,params,enabled,ui,...}`. 450 KB. Exceeds 192 KiB result cap. Use by prefix via host-side filter or allowlist. Never whole.
- `request("document.inspect")` → `{artboards, layers, history, dirty, selection, redo, revision, ...}`.
- Agent edit: `engine.execute {command:"shape.rectangle", params:{x,y,width,height}}` → `{id}`. `document.dirty true`. `history ["Rectangle"]`.
- Shim sends NO dirty message without user input. Needs `agentPending`.
- Creation commands SELECT new object (`selection [4]`).
- `object.setProps` / `object.move` with ids leave user selection alone. E2E "selection unchanged" row uses non-creating mutation.
- User Ctrl/Cmd+Z in frame after agent rectangle removes it (F3 go).

#### Save / export

- `file.save` (no params) opens in-app Save As dialog. Default format VectorCraft → `.vectorcraft`, sibling path. Returns `{pending:"saveOptions"}`.
- Save As format dropdown: VectorCraft, Template, PDF, SVG, SVG Compressed, `.ai`.
- Choose SVG → SVG Options dialog → OK → shim `save {suggestedName:"logo.svg", mime:image/svg+xml}`. Own-file `.svg` save REACHABLE. App marks doc clean after.
- `file.export.svg {svg:{}}` (params) writes with NO dialog. Shim `save {suggestedName:"logo.svg"}` immediately. No user input → `msSinceInput` large.
- `document.export {format:"png"}` without path → `{dataBase64}` in result. No download.
- `file.save` params `{path?, format?, options?, svg?}`. `path` = save-target param to strip (`saveParamNames ["path"]`).
- `ui.screenshot` default reply `{width,height}` only. `{data:true}` adds `pngBase64`. Host forces `data:true`, decodes `pngBase64`. Not raw PNG reply.
- `engine.commands` `ui:true` entries open dialogs. Allowlist excludes them except two save commands.

#### Derived command lists (host-side profile, verifiedVersion 0.16.0)

`allowedCommands` (96):

```
shape.rectangle shape.ellipse shape.polygon shape.star shape.line shape.arc shape.spiral text.create text.setText text.setStyle text.setRangeStyle path.create path.appendAnchor path.moveAnchors path.setAnchors path.reverse path.join select.all select.none select.set select.add select.toggle select.inverse select.allOnArtboard object.move object.rotate object.scale object.reflect object.shear object.transform object.nudge object.setProps object.setBounds object.group object.ungroup object.lock object.hide object.unlockAll object.showAll object.arrange.bringToFront object.arrange.bringForward object.arrange.sendBackward object.arrange.sendToBack object.align object.distribute object.pathfinder.unite object.pathfinder.minusFront object.pathfinder.intersect object.pathfinder.exclude object.pathfinder.divide object.pathfinder.trim object.pathfinder.merge object.pathfinder.crop object.pathfinder.outline object.pathfinder.minusBack object.compoundPath.make object.compoundPath.release object.clippingMask.make object.clippingMask.release paint.setFill paint.setStroke paint.swap paint.none paint.default stroke.set stroke.setAdvanced transparency.set appearance.addFill appearance.addStroke layer.setProps layer.setCurrent layer.move layer.duplicate artboard.setProps artboard.move edit.undo edit.redo edit.clear edit.duplicate file.save file.export.svg document.info document.node document.find document.formats document.json text.getRange text.fonts text.fontList stroke.widthProfile.list transparency.info transparency.opacityMaskInfo object.blend.info text.thread.info text.tabs.get paint.recent
```

`readOnlyCommands` (15):

```
document.info document.node document.find document.formats document.json text.getRange text.fonts text.fontList stroke.widthProfile.list transparency.info transparency.opacityMaskInfo object.blend.info text.thread.info text.tabs.get paint.recent
```

- All allowed exist in `engine.commands`.
- None matches `/open|import|new|close|revert|quit|print|url|script|macro|batch/i`. `path.close` dropped for regex.
- Each read-only run leaves digest unchanged. Digest = `document.inspect` (`artboards`, `layers`, `history`, `dirty`, `selection`, `redo`).

#### Not allowlisted (by design)

- `file.open*`, `file.new*`, `file.close*`, `file.revert`, `app.quit`, `document.open`, `document.activate`.
- `file.saveAs`, `file.saveCopy`, `document.save` (path).
- `file.print`, any `ui:*` dialog, `clipboard.*`, `edit.cut` / `edit.copy` / `edit.paste` (system clipboard).

See change: add-craft-live-control

### 14.9 Live-control status table (task 10.1)

| App | Wave | State | Prerequisite | Page-API global | Upstream issue |
|---|---|---|---|---|---|
| VectorCraft | W1 | enabled 0.16.0 | — (gate §14.8 go) | `window.vectorcraft` (page-api) | upstream shipped (≥ 0.14) |
| LightCraft | W1 (non-blocking) | pending | view-only (preview claim); control requires edit claim. API exists: `globalThis.lightcraft.command` (page-command; 0.9.1 pinned, 0.13.0 latest) | `globalThis.lightcraft` | none needed |
| FilmCraft | W2 | pending | `add-craft-web-media-projects` ships `.fcproj` edit claim (still active change) | `window.filmcraft` (in 0.12.0 index.html) | none needed |
| EffectCraft | W2 | pending | same change ships `.ecproj` claim | `window.effectcraft` (0.16.0 index.html; needs `?nosw` + worker trampoline; check post-install survival at enablement) | none needed |
| GridCraft | W3 | pending | upstream release with `window.gridcraft.request` (latest 0.11.1: none) | — | https://github.com/storytold/gridcraft/issues/1274; photocraft#6450 comment https://github.com/storytold/photocraft/issues/6450#issuecomment-6383791154 |
| WordCraft | W3 | pending | `window.wordcraft.request` + caret rebasing (latest 0.10.0: none) | — | https://github.com/storytold/wordcraft/issues/1589 (comment https://github.com/storytold/wordcraft/issues/1589#issuecomment-6383791347); photocraft#6450 comment |
| PhotoCraft | W3 | pending | `window.photocraft.request` (latest 0.15.1: none) | — | https://github.com/storytold/photocraft/issues/6450 (comment https://github.com/storytold/photocraft/issues/6450#issuecomment-6383791154) |
| PdfCraft | W3 | pending | `window.pdfcraft.request` (latest 0.13.0: none) | — | photocraft#6450 comment (above) |
| DesignCraft | W3 | pending | `window.designcraft.request` (latest 0.12.0: none) | — | photocraft#6450 comment |
| SoundCraft | W3 | pending | `window.soundcraft.request` (latest 0.12.1: none) | — | photocraft#6450 comment |
| DeckCraft | W3 | pending | `window.deckcraft.request` (latest 0.10.0: none) | — | https://github.com/storytold/deckcraft/issues/714; photocraft#6450 comment |
| CADCraft | W3 | pending | `window.cadcraft.request` (latest 0.12.0: none) | — | photocraft#6450 comment |
| FigCraft | W3 | pending | `window.figcraft.request` AND editor-pane claim (separate change); stays pending even if API appears (latest 0.10.0: none) | — | photocraft#6450 comment |

Survey 2026-10-24. Method: grep each latest `-web-` release for page global. Enabling pending app = follow-up change running D8 gate (re-spike under production sandbox, derive lists, record create command, e2e row in `tests/e2e/craft-live-control.spec.ts` `CONTROL_ROWS`).

## 15. Live agent control

Agent drives open web editor in user pane. Opt-in per app via `profile.control`. Headless path stays `pi-craft`.

- Tool: `craft_control({path?, method, params?, instance?})` in `src/bridge/index.ts`.
- Skill: `craft-live-edit` (`.pi/skills/craft-live-edit/SKILL.md`).

### 15.1 Routing flow

1. bridge → lane `craft-web/control`.
2. `src/server/control-router.ts` → session-scoped broadcast `craft-web/control-probe`.
3. Browsers answer `craft-web/control-claim {reqId, instanceId, status, msSinceFocus}`.
4. Router chooses one claim → broadcast `craft-web/control-run`.
5. Only client holding `instanceId` acts. Re-checks: open, visible, same session, `ttlMs` from receipt.
6. `ControlHost.run` → shim relay → `craft-web/control-result`. Accepted only from claiming ws object, once.

- Client→server types = plugin message types. Tier `operate` (unlisted ⇒ operate).
- `craft-web/control-gone` on instance close.

### 15.2 Claim selection

- Status order: wrong-session, unsupported, not-ready, not-visible, eligible.
- Window: closes 300 ms after first eligible claim, else 2 s.
- Choice: smallest `msSinceFocus` ≤ 10 min; tie → earliest claim; else `ambiguous`.
- No eligible: not-visible > not-ready > unsupported. Nothing or only wrong-session → not-open.
- Claim from non-OPEN socket does not count.

### 15.3 Limits and timeouts

- 20 routed requests / 10 s / session (`host.state` exempt).
- Result ≤ 192 KiB. Error ≤ 2 KiB (truncated). Request ≤ 256 KiB (lane).
- App timeout 10 s → instance busy until late result or 30 s.
- Server TTL 13 s → `timeout` = outcome unknown.
- One request in flight per instance.

### 15.4 Host policy (fails closed)

- Top-level methods: `engine.execute`, `engine.commands`, `document.inspect`, `ui.inspect`, `ui.screenshot`, `host.state`.
- `engine.execute` exactly `{command, params?}`. `command` ∈ per-app `allowedCommands`.
- `saveParamNames` stripped. Save target decided by save routing.
- `engine.commands` reply filtered to allowlist (VectorCraft full table 450 KB > cap).
- `ui.screenshot`: host forces `{data:true}`, decodes `pngBase64`, refuses > 16 MP by PNG header, re-encodes JPEG q80 long edge 1280/960/640 ≤ 192 KiB.

### 15.5 Profile

- `CraftAppProfile.control`: `{kind page-api|page-command, global, verifiedVersion, allowedCommands, readOnlyCommands, saveCommands, saveParamNames, digestCommand?}` in `src/shared/app-profiles.ts`.
- Only `{kind, global}` reaches frame (`frameProfile`).
- Lists host-side → edits never force re-prepare.
- Control valid only with edit claim.
- VectorCraft lists: `src/shared/vectorcraft-control.ts`.

### 15.6 Unsaved state

- `agentPending` set when non-read-only request forwarded (any result).
- Unsaved = shim dirty ‖ copyPending ‖ agentPending.
- Own-file save ack clears `agentPending` only if no agent ok since save message and none running.
- Sibling / copy / download never clear.

### 15.7 Saves

- Agent save = app save command through normal `routeSave`. Reply `saveRequested:true, saveSeq, instance`.
- Outcome read via host-implemented `host.state{instance, sinceSeq}` → `{path, unsaved, saves[{seq,pending,outcome?,at}], noSaveYet}`.
- Outcomes: saved, copy, sibling, conflict, cancelled, denied, downloaded, too-large, rejected, exhausted.
- Device downloads: v3 control instance, save routed to download with `msSinceInput` > 2000 → host confirmation (Allow/Block). Block → `save-result ok:false`.

### 15.8 UI

- Toolbar chip `craft-agent-active`.
- `<details>` `craft-agent-log`: ≤ 50 rows (method, outcome, bytes, ≤ 120-char preview).

### 15.9 Kill switch, telemetry, versioning

- Kill switch `plugins['craft-web'].liveControl: false` (read live, server) → `disabled`.
- Telemetry: `telemetry <app> control outcome=<code> ms=<n>`.
- Shim SHIM 2→3 → every other app's v2 tree `shimUpdate:true` (still loads; `minShimVersion` unchanged).
- Control app profile hash changes → re-prepare.

### 15.10 Test fixture

- FakeCraft fixture: `src/server/fixtures/fakecraft/`. `FAKECRAFT_PROFILE` in `src/shared/fixture-profile.ts`.
- Mount + status + test driver route `POST /api/plugins/craft-web/fixture/control` only under `PI_DASHBOARD_FIXTURE_PLUGINS=1`.
- Manifest claim `fakecraft` (`.fakecraft`) in `package.json`. Gate says "not verified" without flag.

### 15.11 Tests

- `src/__tests__/manifest.test.ts` (profile drift).
- `control-host.test.ts`, `control-frame.test.tsx`, `control-router.test.ts`, `fixture.test.ts`, `bridge.test.ts`.
- `tests/e2e/craft-live-control.spec.ts`.

See change: add-craft-live-control

## See also

- [`plugin-seams.md`](plugin-seams.md) — `editor-pane-file-handler` slot, `write-binary`, `serveApp`, `dataDir`.
- [`craft-apps.md`](craft-apps.md) — `provisionWeb`, web-build layout, env.
