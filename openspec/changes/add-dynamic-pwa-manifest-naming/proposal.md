# Add Dynamic PWA Manifest Naming

## Why

Today `public/manifest.json` is a static file shipped in the client build. Every dashboard install — laptop, workstation, NAS, zrok tunnel — registers as a PWA with the same `name`/`short_name`. Users who install the dashboard as a PWA on multiple machines or via multiple origins (LAN host vs. tunnel) end up with several home-screen icons that are visually and textually identical, making them impossible to tell apart.

## What Changes

- Server SHALL serve `/manifest.json` from a dynamic Fastify route that takes precedence over the static asset.
- Dynamic manifest SHALL choose its `name` from, in order: `config.dashboardName` (user override) → client-supplied `Host` header (minus port) → `os.hostname()` → literal `"Pi-Dash"`.
- Final manifest `name` SHALL be `"Pi-Dash · <source>"`; `short_name` SHALL be `<source>` truncated to 12 chars (browser short-name limit is ~12).
- Manifest SHALL include explicit `"id": "/"` for unambiguous PWA identity per origin.
- New optional config field `dashboardName?: string` SHALL be added to `~/.pi/dashboard/config.json`.
- Settings panel SHALL expose a single text input *"PWA display name (shown when installed as an app)"*; blank reverts to host-based default.
- Static `public/manifest.json` SHALL remain as a fallback for the dev case where Vite serves it directly and as the source of the icon/theme/background fields that the dynamic route spreads over.
- Documentation SHALL note that existing installs need re-add on iOS Safari to pick up the new name; Chrome/Edge/Android update within ~24h.

## Impact

- **Affected specs:** `pwa-manifest` (MODIFIED: "Web app manifest" requirement loses fixed-string clause, gains dynamic-naming + id + override clauses)
- **Affected code:**
  - `packages/server/src/server.ts` — register new `/manifest.json` route before static handler
  - `packages/server/src/routes/` — new `manifest-route.ts` (or inline if small)
  - `packages/shared/src/config.ts` — add `dashboardName?: string` to dashboard config type + defaults
  - `packages/client/src/components/SettingsPanel.tsx` — add text input under existing general section
  - `public/manifest.json` — strip `name`/`short_name` defaults? Keep as fallback; clarify in comment
  - `AGENTS.md` / `docs/file-index-server.md` — index the new route
- **Not affected:** service worker, icons, theme colors, `index.html` meta tags
- **Migration:** none; new config field is optional, defaults preserve current behaviour (modulo dynamic name, which only improves multi-install UX)
- **PWA install caveat:** existing iOS Safari installs frozen until uninstall + reinstall; Chrome/Edge/Android refresh automatically
