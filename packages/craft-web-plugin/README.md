# @blackbelt-technology/pi-dashboard-craft-web-plugin

Edit and view files in the dashboard editor pane with the ArtCraft web builds. The file-handler mode
switcher (and the binary-file notice) offers **Edit in &lt;App&gt;** / **View in &lt;App&gt;**: the app's web
build runs in a sandboxed, opaque-origin frame inside the pane, and every save goes through the core
`write-binary` path behind a per-format validator.

| App (verified web build) | Files | Saves |
|---|---|---|
| WordCraft 0.8.0 | `.docx` | in place |
| GridCraft 0.8.0 | `.xlsx` | in place |
| PdfCraft 0.9.0 | `.pdf` | in place (incremental update) |
| CADCraft 0.8.0 | `.dxf` | in place (DXF R2000) |
| DesignCraft 0.9.0 | `.designcraft` | in place |
| SoundCraft 0.8.0 | `.scraftz` | in place (first save asks: saves are named after the session) |
| PhotoCraft 0.10.0 | `.psd`; `.png .jpg .jpeg .webp .tif .tiff` | `.psd` in place; rasters → new `<stem>.psd` next to the file |
| VectorCraft 0.16.0 | `.svg` | new `<stem>.vectorcraft` next to the file |
| DeckCraft 0.7.0 | `.deckcraft`; `.pptx` | `.deckcraft` in place; `.pptx` → new `<stem>.deckcraft` |
| LightCraft 0.9.1 | `.dng .cr2 .cr3 .nef .arw .raf .orf .rw2` | view only (exports download to the device) |

- **Opt-in** — `defaultEnabled: false`; per-app switches `apps.<app>.enabled` (default `true`) are enforced
  server-side as well (prepare and saves are refused for a disabled app).
- **Adapter profiles** — one declarative row per app (`src/shared/app-profiles.ts`): ready hook, title signal
  or opened fallback, dirty rule, save-name rule, frame URL flags, worker trampoline, version channel, claims.
- **Prepared on request** — `POST /api/plugins/craft-web/prepare/:app` downloads the pinned, checksum-verified
  `<app>-web-<ver>.zip` into `~/.pi/dashboard/plugin-data/craft-web/<app>-web/` (a static GET never downloads),
  externalizes every inline script, injects the profile + shim and points `current` at it.
  `GET /api/plugins/craft-web/status` reports per app `ok | disabled | restart-required | not-verified |
  not-prepared | shim-outdated | offline | checksum-mismatch | launcher-source | extract-failed`
  (`shimUpdate: true` = an older supported build still loads; Update is offered).
- **Version channel** — WordCraft may follow `latest`; every other app is fixed to its verified build.
- **Served read-only** — `ctx.serveApp` mount `/apps/craft-<app>/` with a per-request CSP (script and connect
  sources limited to the mount, no network for the app, `frame-ancestors 'self'`).
- **Validated saves** — worker-run format validators (OOXML, PDF, DXF, zip bundles, PSD, raster signatures,
  VectorCraft JSON, SVG script filter); a format without a validator gets no edit claim.
- **Overrides** — `<APP>_WEB_DIR` (copy of a local build), `<APP>_WEB_VERSION` (pin); `CRAFT_SOURCE=launcher`
  never downloads the web build.

Design: `openspec/changes/edit-office-in-pane-with-craft-web/design.md` (D1–D5),
`openspec/changes/extend-craft-web-to-all-apps/design.md` (D1–D11). Details: `docs/craft-web-plugin.md`.
