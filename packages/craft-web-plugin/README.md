# @blackbelt-technology/pi-dashboard-craft-web-plugin

Edit Office documents in the dashboard editor pane. For a `.docx` (later `.xlsx`, `.pptx`) the
file-handler mode switcher offers **Edit in WordCraft**: the ArtCraft web build runs in a sandboxed,
opaque-origin frame inside the pane, and every save goes through the core `write-binary` path.

- **Opt-in** — `defaultEnabled: false`; per-app switches `apps.<app>.enabled` (default `true`) are enforced
  server-side as well (prepare and saves are refused for a disabled app).
- **Prepared on request** — `POST /api/plugins/craft-web/prepare/:app` downloads the pinned, checksum-verified
  `<app>-web-<ver>.zip` into `~/.pi/dashboard/plugin-data/craft-web/<app>-web/` (a static GET never downloads),
  injects the host shim and points `current` at it. `GET /api/plugins/craft-web/status` reports per app
  `ok | disabled | restart-required | not-verified | not-prepared | shim-outdated | offline | checksum-mismatch | launcher-source | extract-failed`.
- **Served read-only** — `ctx.serveApp` mount `/apps/craft-<app>/` with a per-request CSP (script and connect
  sources limited to the mount, no network for the app, `frame-ancestors 'self'`).
- **Validated saves** — a worker-run OOXML validator accepts a save only when the bytes are a zip package whose
  content types declare, and whose archive contains, the main part of the target kind.
- **Overrides** — `<APP>_WEB_DIR` (copy of a local build), `<APP>_WEB_VERSION` (pin); `CRAFT_SOURCE=launcher`
  never downloads the web build.

Design: `openspec/changes/edit-office-in-pane-with-craft-web/design.md` (D1–D5).
