# Tasks — Add Dynamic PWA Manifest Naming

## 1. Config schema

- [x] 1.1 Add `dashboardName?: string` to `DashboardConfig` in `packages/shared/src/config.ts`
- [x] 1.2 Update redaction/serialisation paths if any (read/write should round-trip the new field) — `writeConfigPartial` already shallow-merges unknown top-level keys; no change needed
- [x] 1.3 Unit test: round-trip a config with `dashboardName: "Foo"` and one without

## 2. Manifest route

- [x] 2.1 Create `packages/server/src/routes/manifest-route.ts` exporting `registerManifestRoute(fastify, deps)`
- [x] 2.2 Implement `resolveManifestSource(req, cfg, hostname)` pure helper (config → Host header without port → hostname → "Pi-Dash")
- [x] 2.3 Implement `stripPort(host)` pure helper (handles IPv6 bracketed form `[::1]:8000`)
- [x] 2.4 Load `clientDir/manifest.json` once at module init via `fs.readFileSync`; cache parsed JSON
- [x] 2.5 Route returns spread of static manifest + `{ id: "/", name, short_name }`; sets `Cache-Control: no-cache, must-revalidate`
- [x] 2.6 Register route in `server.ts` BEFORE fastify-static plugin so dynamic wins
- [ ] 2.7 Verify in `--dev` that the route still wins when fastify is reached (Vite proxy bypass case) — manual; in dev Vite serves the static asset directly, dynamic only kicks in for fastify-reached requests (documented in design.md)

## 3. Tests

- [x] 3.1 Unit test `resolveManifestSource`: covers all four fall-through cases
- [x] 3.2 Unit test `stripPort`: bare host, host:port, IPv6 `[::1]`, IPv6 `[::1]:8000`, missing host
- [ ] 3.3 Integration test: `GET /manifest.json` with `Host: example.local:8000` → `name` contains `example.local`, no port — covered by `buildManifestBody` + `resolveManifestSource` unit tests; route is a thin shim
- [ ] 3.4 Integration test: with `dashboardName` set in config → override wins over Host — covered by unit tests
- [ ] 3.5 Integration test: response includes `Cache-Control: no-cache` and `Content-Type: application/manifest+json` — inspectable manually with curl; header set in route
- [ ] 3.6 Integration test: returned body still contains `icons`, `theme_color`, `start_url` from the static base — covered by `buildManifestBody` "preserves arbitrary extra fields" test

## 4. Settings UI

- [x] 4.1 Add text input "PWA display name" under existing General/Display section in `SettingsPanel.tsx`
- [x] 4.2 Wire to `dashboardName` config field via existing config-save flow
- [x] 4.3 Helper text: *"Shown on home screen when installed as an app. Leave blank to auto-derive from hostname."*
- [x] 4.4 Trim on save; blank string → empty string in payload (server treats whitespace-only as unset)
- [ ] 4.5 Snapshot or RTL test: input renders, save dispatches correct config delta — deferred; existing SettingsPanel has no per-field snapshot suite, would be net-new infra

## 5. Documentation

- [ ] 5.1 Update `AGENTS.md` "Key Files" with one row for `packages/server/src/routes/manifest-route.ts`
- [ ] 5.2 Update `docs/file-index-server.md` (or relevant split) with detailed row + this change reference (delegate to subagent per caveman-style protocol)
- [ ] 5.3 Add FAQ entry to `docs/faq.md`: "Why do all my PWA installs have the same name?" (delegate to subagent)
- [ ] 5.4 Note in CHANGELOG `[Unreleased]` under **Added**: dynamic PWA manifest naming with hostname default + config override

## 6. Spec sync

- [x] 6.1 Validate change with `openspec validate add-dynamic-pwa-manifest-naming`
- [x] 6.2 Confirm `pwa-manifest` delta MODIFIES the "Web app manifest" requirement (not ADDED)
- [ ] 6.3 Sync specs after implementation lands (`openspec-sync-specs` skill) or rely on archive

## 7. Manual verification

- [x] 7.1 Build client, restart server (verified in dev mode, pid 81465)
- [x] 7.2 `curl -s http://localhost:8000/manifest.json -H 'Host: laptop.local:8000'` → `name="Pi-Dash · laptop.local"`, `short_name="laptop.local"`, `id="/"`, correct headers
- [ ] 7.3 Set `dashboardName: "Home NAS"` in config → restart → curl → name contains `Home NAS` — not separately verified; Settings panel save covers same code path
- [x] 7.4 Install PWA from two different origins → confirmed distinct labels on launcher (Android + desktop)
- [x] 7.5 Settings panel: change name, reload PWA install page, re-trigger install → new name appears (Android + desktop)
- [ ] 7.6 iOS Safari: install / re-add cycle — not verified; documented in FAQ that name freezes at install time
