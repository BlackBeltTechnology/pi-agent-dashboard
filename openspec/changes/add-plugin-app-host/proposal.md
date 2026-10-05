## Why

Plugins are shipping their own React apps: the voice wall (`add-voice-wall-plugin`, `/apps/wall/`) and the AI Team app (`add-team-plugin`, `/apps/team/`). Each is a separately built single-page app that must also work **opened directly by URL** (share links, a projector, a separate deployment). Inside the dashboard, operators want them **embedded the way the OpenSpec board is**: reached from a folder slot and folder-menu entries, rendered in the content area next to the sidebar, with a Back that returns to the folder, and without each app re-implementing sign-in, theme or a way back.

The building blocks mostly exist. Folder plugins already combine a state-only `sidebar-folder-section` pill (`FolderOpenSpecSection`, `FolderKbSection`), `useFolderMenuItem` entries and a `shell-overlay-route` at `/folder/:encodedCwd/<x>` (Goals, KB, Automations). Two things are missing:
1. `shell-overlay-route` offers only `"dialog"` (over a scrim) and `"page"` (full viewport). Neither renders **in the content area beside the sidebar**, which is where the core OpenSpec board renders.
2. There is no contract that lets one app component run both inside a slot and standalone.

`add-voice-assistant-dashboard-plugin` planned a plugin-only "live-target bridge" just to embed the wall; this change replaces it.

## What Changes

- **`shell-overlay-route` gains `presentation: "content"`.** Desktop: rendered in the shell content area with the sidebar visible and interactive, no scrim or underlay — exactly like `/folder/:encodedCwd/openspec`. Mobile: the `MobileShell` detail panel at the declared `depth`. Same URL, deep-link and back rules as the other presentations.
- **Embedded plugin apps use existing slots, OpenSpec-board style:**
  - `sidebar-folder-section`: a state-only entry `<App> (state) →` (like `OpenSpec (N) →`);
  - `useFolderMenuItem`: open / share / open standalone entries;
  - `shell-overlay-route` with `presentation: "content"`, `depth: 2`, `parentPath: "/folder/:encodedCwd"`, rendering the app.
- **One app, two hosts.** An app is a React component that reaches its environment only through an `AppHost` contract. Inside the slot the plugin wraps it in `<EmbeddedApp>` (from `dashboard-plugin-runtime`), which provides the embedded host and the **board-style top bar**: Back · breadcrumb (folder › app) · the app's `HeaderContext` · app actions — the same layout as the OpenSpec board's top bar. Standalone, the plugin's own `/apps/<id>/` page mounts the same component with `createStandaloneHost()` and no dashboard chrome.
- **Contract in `app-kit`** (`@blackbelt-technology/pi-dashboard-app-kit`, change `extract-standalone-app-kit`): `AppHost`, `defineDashboardApp`, `AppHostProvider`, `useAppHost`, `createStandaloneHost`, `<StandaloneBar>`.
- **Navigation from an app** through the host: `openSession`, `openFolder`, `navigateDashboard` (validated same-origin path), `openStandalone` (named window, for a projector), `requestFullscreen`.
- **No new route, no new manifest field, no header extraction.** The sidebar and its header (π, theme, tunnel/zrok, YOLO, server, Discord, settings) stay exactly as they are, because the app renders beside them.

## Capabilities

### New Capabilities
- `plugin-embedded-app`: `<EmbeddedApp>` (embedded `AppHost` + board-style top bar), `HeaderContext` placement, host navigation and its validation, standalone parity, never-stranded states, embedding rules.

### Modified Capabilities
- `shell-overlay-route`: third presentation `"content"` (content area beside the sidebar; mobile detail panel).

## Discipline Skills

- **`security-hardening`** — embedded apps run in the dashboard's React tree with the operator's session (trusted plugins only); `navigateDashboard` path validation (open redirect); embedded vs standalone auth split.
- **`doubt-driven-review`** — `AppHost` and `presentation: "content"` are public plugin API consumed by in-flight changes; review before they stand.
- **`performance-optimization`** — app code must stay in the plugin's lazily loaded chunk; measure the dashboard's initial bundle before/after.
- **`review-code`** — before commit.
- Not triggered: `observability-instrumentation` beyond logging rejected navigations.

## Impact

- `packages/dashboard-plugin-runtime`: `presentation: "content"` in the validator, generator and `ShellOverlayRouteSlot`; `<EmbeddedApp>` + embedded host.
- `packages/client`: `App.tsx` / `ShellContent` place `"content"` claims where the OpenSpec board renders; mobile depth mapping.
- `packages/app-kit` (via `extract-standalone-app-kit`): contract + standalone host.
- Consumers: `add-voice-wall-plugin` (wall: folder slot, menu, `/folder/:encodedCwd/wall`), `add-team-plugin` (decides its own placement), `add-voice-assistant-dashboard-plugin` (links to the wall route; drops its live-target bridge).
- Compatibility: additive (new enum value; existing claims unchanged). Rollback: remove `"content"` and `<EmbeddedApp>`; apps stay reachable standalone at `/apps/<id>/`.
