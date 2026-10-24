# craft-web-plugin.md — index

Pull-only condensed map. Source: `docs/craft-web-plugin.md`.

## 1. What / why
- Pkg `packages/craft-web-plugin`. Edit/View in <App> on editor-pane tabs.
- Web build in sandboxed iframe. Saves only via `POST /api/file/write-binary`.
- Types: A own-format · B native + `siblingExtensions` · C preview · D no claim.

| App | Ver | Claim | Ext | Mode | Saves |
|---|---|---|---|---|---|
| WordCraft | 0.8.0 | `wordcraft` | `.docx` | edit | in place |
| GridCraft | 0.8.0 | `gridcraft` | `.xlsx` | edit | in place |
| PdfCraft | 0.9.0 | `pdfcraft` | `.pdf` | edit | in place (incremental) |
| CADCraft | 0.8.0 | `cadcraft` | `.dxf` | edit | in place (R2000) |
| DesignCraft | 0.9.0 | `designcraft` | `.designcraft` | edit | in place |
| SoundCraft | 0.8.0 | `soundcraft` | `.scraftz` | edit | session name |
| PhotoCraft | 0.10.0 | `photocraft` | `.psd` | edit | in place |
| PhotoCraft | 0.10.0 | `photocraft-raster` | raster | edit + sibling | `<stem>.psd` |
| VectorCraft | 0.16.0 | `vectorcraft` | `.svg` | edit + sibling | `<stem>.vectorcraft` |
| DeckCraft | 0.7.0 | `deckcraft` | `.pptx` | edit + sibling | `<stem>.deckcraft` |
| DeckCraft | 0.7.0 | `deckcraft-native` | `.deckcraft` | edit | in place |
| LightCraft | 0.9.1 | `lightcraft` | raw | preview | device download |

- Not claimed: FilmCraft 0.9.0, EffectCraft 0.11.1 (deferred), FigCraft 0.7.0 (type D).
- Dropped: `.dwg` (refused), `.odt`/`.rtf` (save as `.docx`).
- `latestChannel:true`: WordCraft only. DeckCraft pinned 0.7.0 (0.8.0 panics).

## 2. Enabling
- `defaultEnabled: false`.
- `plugins["craft-web"].apps.<app>.enabled` (default `true`).
- `plugins["craft-web"].apps.<app>.version`: `pinned` (default) | `latest`. Env `<APP>_WEB_VERSION` overrides.
- Read live by status/prepare/validator. Server entry needs restart.
- Claim in manifest only when registry `webVersion` set.

## 3. Provisioning
- `POST /api/plugins/craft-web/prepare/:app` (`control`, single-flight). Never from GET.
- Downloads `<app>-web-<ver>.zip`, SHA256-verified. Dir `~/.pi/dashboard/plugin-data/craft-web/<app>-web/`.
- Zip wrap `<app>-web-<ver>/` hoisted by `provisionWeb`.
- `postInstall` (`src/server/post-install.ts`):
  - Inline scripts → `inline-<n>-<hash>.js`. Inline `importmap` → fail.
  - Inject ready hook: `trunk` | `load-ready-ms` | `after-start-call`. Must match once.
  - Writes worker / profile / shim files, markers, `.gz`, `craft-build.json`.
- `profileHash` = hash(profile + ready + workerTrampoline).
- `SHIM_VERSION = 3` (`src/shim/craft-shim.js`). Bump on behaviour change.
- Shim compat: build > plugin → outdated. Build < `minShimVersion` → outdated. Build < plugin → `shimUpdate:true`. Profile mismatch → outdated.
- `minShimVersion`: WordCraft `1`, new apps `2`.
- Overrides: `<APP>_WEB_DIR`, `<APP>_WEB_VERSION`. `CRAFT_SOURCE=launcher` never downloads.

### Status reasons
- `disabled` 403 · `restart-required` 409 · `not-verified` 409 · `not-prepared` · `shim-outdated` · `offline` 503 · `checksum-mismatch` 502 · `launcher-source` 409 · `extract-failed` 502.
- Latest channel: background metadata lookup (24 h). Never downloads. Failed update keeps prepared build.

### Settings
- Claim `settings-section` `CraftWebSettings`, route `/settings/plugins/craft-web`.
- Edits → draft → host Save Bar. Button `Download`/`Update <App>`.

## 4. Routes
- `GET .../status` `observe` · `POST .../prepare/:app` `control` · `POST .../csp-report` · `POST .../telemetry` · `GET /apps/craft-<app>/` (503 until prepared) · `POST /api/file/write-binary`.
- Telemetry: `{app, kind:"open", outcome}` (`title|fallback|timeout|start-failed`) or `{app, kind:"reject", ext}`.
- Errors: 400 `invalid-report`, 429 `rate-limited`.

## 5. Sandbox
- `src=/apps/craft-<app>/index.html[?frameParams]#n=<nonce>`.
- `sandbox="allow-scripts"`, no `allow-same-origin` → opaque origin.
- No `allow-downloads`. Exports via host. Never add.
- Probe: WebGPU → WebGL2 (`?webgl`) → else no iframe.
- Worker trampoline: `Worker` http(s) → `blob:` bootstrap. `SharedWorker` untouched.
- Service workers unavailable. `nosw` flag for SW apps.

### CSP
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
- `<mount base>` = `<public origin>/apps/craft-<app>/`. `/api/*` blocked.

## 6. Shim protocol
- Accept only `event.source === iframe.contentWindow` + nonce + known type + size cap.

Shim → host: `ready{shimVersion, control}` (≤ 60 s) · `opened{title, confirmed?}` (15 s) · `start-failed` · `save{suggestedName, mime, bytes, msSinceInput}` · `dirty{value}` · `blocked{what}` · `csp` · `navigate-blocked` · `control-result{id, ok, result?, error?, code?}`.

Host → shim (`targetOrigin "*"`): `open{name, bytes}` · `save-result{ok, error?, own?}` · `control{id, method, params?}`.
- `page-api`: `window[global].request(method, params)`.
- `page-command`: `engine.execute` only → `window[global].command(...)`.

### Behaviours
- Title: anchored regex, capture 1 = name, dirty marker stripped. Dashes `- – —`.
- No `title` profile → `opened{confirmed:false}` after `openedFallbackMs`.
- Save: stubbed picker or anchor-download interception.
- Refused: file inputs, open pickers, file drop/paste.
- Drop right after `ready` ignored. Synthetic drop after title signal or 3 s.
- WebRTC constructors deleted.

## 7. Dirty
- eframe `Title("… • …")`: `•` = dirty. Plus trusted input.
- Clean only if title clean and no later input.
- `cleanOnAckedSave: true` (all but WordCraft): own acked save with no input → clean.
- Preview: `dirty` ignored. Copy/sibling save: stays dirty.
- No `dirty` within 10 s → `"unknown"`.

## 8. Save mapping (`src/client/save-routing.ts`)
1. Preview → device download.
2. Ext in `siblingExtensions` → `sibling`.
3. Other ext → download. Never workspace write.
4. Over `maxBytes` → `too-large`.
5. `saveName: "inner-title"` → `save-as` once.
6. Same stem → `own`. Else `save-as`.
- `saveTarget` toggle `overwrite` (default) | `copy`.
- Sibling: `POST .../write-binary?mode=copy&siblingExt=<.ext>`. `<stem>.<ext>`, then `<stem>-<n>.<ext>` (n ≤ 99).
- Dialog `craft-sibling`: Create and open · Create · Download · Cancel.

## 9. Validators
- Dispatcher `src/server/validators/index.mjs`. Reject-only, bounded. Reject → 422.
- OOXML `.docx .xlsx .pptx`: content types, ≤ 1 MB, no DOCTYPE/ENTITY.
- `.pdf`: header + `%%EOF`. `.dxf`: binary sentinel or ASCII pairs.
- `.designcraft .scraftz .deckcraft`: zip + mimetype/member checks.
- `.psd`: `8BPS` v1/v2. Raster: per-ext signature.
- `.svg`: reject script/foreignObject/iframe/embed/object, `on*`, `javascript:`.
- `.vectorcraft`: JSON leading `"format": "vectorcraft"`.
- Zip: central dir only, ≤ 10 000 entries.
- `/api/file/raw` serves `.svg` inline. Hardening = follow-up 6.3.

## 10. Limits
- Caps: office 40 MB; `.svg` 16 MiB; others `HANDLER_MAX_BYTES`.
- Zip guard ≤ 2000 entries, ≤ 512 MiB.
- Timeouts: ready 60 s, opened 15 s. `openedFallbackMs` 1000–15000.
- CSP report: 1/directive/10 s, max 20.

## 11. WordCraft spike
- Pass on Chromium. `webVersion = "0.8.0"`. Unverified: Firefox/Safari, zrok.

## 12. Residuals (accepted)
- `location.href =` navigation not interceptable.
- WebRTC recoverable via nested frame.
- Trust = pinned checksum-verified bundles.
- Stale frame after `current` swap → "could not start".
- Mount outlives disable until restart.
- Worker trampoline breaks `self.location` apps. Per-profile flag.

## 13. Tests
- `packages/craft-web-plugin/src/{server,client,shim}/__tests__/`.
- `src/__tests__/manifest.test.ts`: profile ↔ claims ↔ `webVersion` ↔ validators.
- `tests/e2e/craft-web-editor.spec.ts`. Fixtures `docker/fixtures/sample-git/craft/`.

## 14. Spikes (Waves 1–4)
### 14.1–14.7 Waves 1–4, observability, upstream
- Waves 1–2: Trunk loaders most apps. Custom: LightCraft, FilmCraft, EffectCraft.
- `new Worker(httpUrl)` from `null` origin fails. Blob bootstrap works.
- Wave 3 LightCraft: go under prod CSP. Wave 4 media: deferred to `add-craft-web-media-projects`.
- Logs (no paths): `telemetry <app> open outcome=<o>`, `validator-reject`, `csp-report`.
- Upstream: `storytold/<app>` pdfcraft#3640, cadcraft#1717, designcraft#1356, soundcraft#809, deckcraft#1058, lightcraft#2397, filmcraft#2579; deckcraft#1059, figcraft#916, craft-libs#193, gridcraft#2050.

### 14.8 Live control: VectorCraft re-spike — GO
- 2026-10-24. `vectorcraft-web` 0.16.0. `window.vectorcraft` since 0.14.0.
- `engine.commands` 450 KB > 192 KiB cap. Filter by allowlist.
- `engine.execute {command:"shape.rectangle"}` → `{id}`. No dirty without input → `agentPending`.
- `file.save` (no params) → Save As dialog. `file.export.svg {svg:{}}` → no dialog.
- `allowedCommands` (96) + `readOnlyCommands` (15) in `src/shared/vectorcraft-control.ts`.
- Not allowlisted: `file.open*|new*|close*|revert|saveAs|saveCopy`, `app.quit`, `document.open|save|activate`, `file.print`, `ui:*`, `clipboard.*`, `edit.cut|copy|paste`.

See change: add-craft-live-control

### 14.9 Live-control status (2026-10-24)
- Enabled: VectorCraft.
- Blocked upstream (`window.<app>.request` missing): GridCraft, WordCraft, PhotoCraft, PdfCraft, DesignCraft, SoundCraft, DeckCraft, CADCraft, FigCraft.
- Blocked on claim: FilmCraft, EffectCraft. LightCraft: view-only.

## 15. Live agent control
- Opt-in per app via `profile.control`. Headless path stays `pi-craft`.
- Tool `craft_control({path?, method, params?, instance?})` (`src/bridge/index.ts`). Skill `craft-live-edit`.

### 15.1 Routing
- Lane `craft-web/control` → `control-router.ts` → `control-probe` → `control-claim` → one picked → `control-run`.
- Client re-checks open, visible, session, `ttlMs`. Result accepted once.

### 15.2 Claim selection
- Order: wrong-session, unsupported, not-ready, not-visible, eligible.
- Window 300 ms after first eligible, else 2 s. Smallest `msSinceFocus` ≤ 10 min wins; tie → earliest; else `ambiguous`.

### 15.3 Limits
- 20 req / 10 s / session (`host.state` exempt). Result ≤ 192 KiB. Request ≤ 256 KiB.
- App timeout 10 s. Server TTL 13 s → `timeout`. One in flight per instance.

### 15.4 Host policy (fails closed)
- Methods: `engine.execute|commands`, `document.inspect`, `ui.inspect`, `ui.screenshot`, `host.state`.
- `engine.execute` = `{command, params?}`, command ∈ `allowedCommands`.
- Screenshot: refuse > 16 MP. JPEG q80, long edge ≤ 1280, ≤ 192 KiB.

### 15.5 Profile
- `CraftAppProfile.control` in `src/shared/app-profiles.ts`. Frame gets `{kind, global}` only. No re-prepare on list edits.

### 15.6 Unsaved state
- `agentPending` on non-read-only forward. Unsaved = dirty ‖ copyPending ‖ agentPending.
- Own save ack clears `agentPending` only if no agent ok since. Sibling/copy/download never clear.

### 15.7 Saves
- Agent save via `routeSave`. Reply `saveSeq`. Poll `host.state{instance, sinceSeq}`.
- Outcomes: saved, copy, sibling, conflict, cancelled, denied, downloaded, too-large, rejected, exhausted.
- Download with `msSinceInput` > 2000 → host Allow/Block.

### 15.8 UI and kill switch
- Chip `craft-agent-active`. Log `craft-agent-log` ≤ 50 rows.
- `plugins['craft-web'].liveControl: false` → `disabled` (live).
- Telemetry `telemetry <app> control outcome=<code> ms=<n>`.

### 15.9 Fixture and tests
- FakeCraft `src/server/fixtures/fakecraft/`. Driver gated by `PI_DASHBOARD_FIXTURE_PLUGINS=1`.
- Tests: `control-*`, `fixture`, `bridge`, `manifest`. E2E `tests/e2e/craft-live-control.spec.ts`.

See change: add-craft-live-control

## See also
- `plugin-seams.md`, `craft-apps.md`.
