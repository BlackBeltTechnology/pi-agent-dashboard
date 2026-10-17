# DOX — tests/e2e/obs

One row per file. See change: add-obs-studio-plugin.

| File | Purpose |
|------|---------|
| `obs-studio-plugin.spec.ts` | L3 OBS panel + settings card with `/api/plugins/obs-studio/*` stubbed via `page.route` (harness has no OBS; shell, claim, standalone host, settings section real). F1 settings card: empty → provision hint + no controls; healthy stub (`32.2.2`, `all-interfaces`) → version + exposure warning, "Open OBS panel" → `/obs/` with dialog count 0 + `sidebar-collapse` visible. F2 states: blocked → `obs-blocked`, no Start/Retry/scenes; stopped → Start posts `POST /api/services/obs/start`; auth-failed → `provision --update` hint; no Stop in any state. F3 `/apps/obs/` → scene names + `obs-preview` `data:`/`blob:` src, no sidebar. |
