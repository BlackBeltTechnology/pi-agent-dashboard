# Reorganize settings into pages

## Why

The settings panel grew from the 4-tab `settings-tabbed-layout` into 7 uneven top-tabs. Two tabs (`General`, `Advanced`) each carry ~8 unrelated sections while `Servers`/`Packages`/`Plugins` carry one. `Advanced` re-renders sections that already live elsewhere (Known Servers, Display Prefs, Trusted Networks) — legacy accretion. Content is locked to `max-w-2xl`, leaving the right half of the panel blank. Top-tabs do not scale past ~7 labels.

Separately, the plugin `settings-section` registry keys placement off a `tab` string (`forTab`, default `"general"`), and the typed allow-list `VALID_SETTINGS_TABS` is already **stale**: it omits `plugins` and does not match the panel's actual 7 tabs. Any reorg must move the registry contract forward in lockstep or plugin claims silently misplace.

## What Changes

- **Left-nav page layout**: Replace the 7 top-tabs with a left nav rail grouped into sections (Dashboard / Network / Extensions / Advanced). Each concern becomes a focused single-purpose page. The rail reclaims the empty left gutter; content gets full width.
- **Regroup sections (10 pages, dupes removed)**: `general` (language + display only), `server` (ports, auto-shutdown, tunnel, memory limits), `sessions` (spawn, ordering, timeouts, worktree, PWA name), `remote` (known servers, network discovery), `security` (auth, trusted networks), `providers` (provider auth, LLM providers, API proxy), `packages`, `plugins`, `openspec` (polling, profiles), `developer` (diagnostics, tools, spawn failures, dev build, editor, debug events). Each section has exactly one home.
- **Additive registry contract**: Extend `SettingsTab` / `VALID_SETTINGS_TABS` to the full page-id set (reconcile the existing `plugins`/`advanced` drift). Keep the `settings-section` `tab` field and `forTab`'s `"general"` default so unmigrated and third-party plugin claims keep working. Plugins MAY target any page id; `general` stays the fallback.
- **Dual-URL routing**: Make `/settings/:page?` canonical and bookmarkable with real back/forward. Keep `/settings?tab=<id>` working forever via a one-time `replace`-redirect to the canonical path. A single `SettingsPanel` instance stays mounted across page changes so the cross-page unsaved draft (save-applies-across-all-tabs) is preserved.
- **Alias old ids**: `?tab=advanced` and `?tab=servers` resolve to their new homes so old links/bookmarks land correctly.

## Mockup

Interactive clickable mockup (open in a browser): [`mockup/settings-mockup.html`](mockup/settings-mockup.html). Styled to match the dashboard light theme; nav rail and form controls are live.

Proposed left-nav layout:

```
+--------------------------------------------------------------+
|  <- Settings                            [Restart] [Save]      |  fixed header
+----------------------+---------------------------------------+
| DASHBOARD            |  General                              |
|   General        *   |  --------------------------------     |
|   Server             |  Interface   Language [English v]     |
|   Sessions           |  Display     Theme    [System  v]     |
| NETWORK              |              Compact cards  ( o)       |
|   Remote Servers     |                                       |
|   Security           |                                       |
| EXTENSIONS           |   (rail fills the old empty gutter;   |
|   Providers          |    content gets full width)           |
|   Packages           |                                       |
|   Plugins            |                                       |
|   OpenSpec           |                                       |
| ADVANCED             |                                       |
|   Developer          |                                       |
+----------------------+---------------------------------------+
```

Rendered reference screenshots:
- Before (today, one crowded General tab): [`mockup/current-general.png`](mockup/current-general.png)
- After — General page (slim): [`mockup/page-general.png`](mockup/page-general.png)
- After — Sessions page (busy page example): [`mockup/page-sessions.png`](mockup/page-sessions.png)

## Capabilities

### Modified Capabilities
- `settings-panel`: Replace tabbed layout with left-nav page layout; extend the settings-section registry page-id contract; add dual-URL (`/settings/:page?` + legacy `?tab=`) routing with preserved cross-page draft.

## Impact

- `packages/client/src/components/SettingsPanel.tsx` — layout (nav rail + page switch), route param resolution, `?tab=` alias redirect.
- `packages/shared/src/dashboard-plugin/slot-types.ts` — extend `SettingsTab` + `VALID_SETTINGS_TABS`; reconcile `plugins`/`advanced` drift.
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` — `forTab` default unchanged (`"general"` fallback) but validated against new id set.
- `packages/client/src/App.tsx` (or route table) — add `/settings/:page?` route + redirect from `/settings`.
- Bundled plugins targeting `tab: "general"` (honcho, goal, jj, roles, subagents, flows-bridge) keep rendering on the General page by default; no manifest change required.
- Tests: SettingsPanel layout/nav, route resolution, `?tab=` alias redirect, save-across-pages draft, registry id validation.
