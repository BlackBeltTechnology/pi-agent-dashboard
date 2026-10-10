## Why

Plugins are shipping their own React apps: the voice wall (`add-voice-wall-plugin`, `/apps/wall/`) and the AI Team app (`add-team-plugin`, `/apps/team/`). Each is a separately built single-page app that must also work **opened directly by URL** (share links, a projector, a separate deployment). Inside the dashboard, operators want them **embedded the way the OpenSpec board is**: reached from a folder slot and folder-menu entries, rendered in the content area next to the sidebar, with a Back that returns to the folder, and without each app re-implementing sign-in, theme or a way back.

The building blocks mostly exist. The `AppHost` contract and standalone host already ship in `app-kit` (`packages/app-kit/src/react/app-host.tsx`, archived `extract-standalone-app-kit`), and `openspec/specs/team-app` already requires the team app to embed through global `/team/` and folder `/folder/<cwd>/team/` content routes once the dashboard has an app host. Folder plugins already combine a state-only `sidebar-folder-section` pill (`FolderOpenSpecSection`, `FolderKbSection`), `useFolderMenuItem` entries and a `shell-overlay-route` at `/folder/:encodedCwd/<x>` (Goals, KB, Automations). Three things are missing:
1. `shell-overlay-route` offers only `"dialog"` (over a scrim) and `"page"` (full viewport). Neither renders **in the content area beside the sidebar**, which is where the core OpenSpec board renders.
2. Claim paths match an exact segment count, so an app's own sub-routes (`/wall/graph`, `/team/agent/x`) cannot deep-link.
3. There is no embedded `AppHost` implementation — nothing hosts an app component inside a slot.

`add-voice-assistant-dashboard-plugin` planned a plugin-only "live-target bridge" just to embed the wall; this change replaces it.

## What Changes

- **`shell-overlay-route` gains `presentation: "content"`.** Desktop: rendered in the shell content area with the sidebar visible and interactive, no scrim or underlay — exactly like `/folder/:encodedCwd/openspec`. Mobile: the `MobileShell` detail panel at the declared `depth`. Same URL, deep-link and back rules as the other presentations.
- **Claim paths may end in `/*?`** (optional trailing wildcard), so one claim covers an app's base route and all its sub-routes.
- **Embedded plugin apps use existing slots, OpenSpec-board style:**
  - `sidebar-folder-section`: a state-only entry `<App> (state) →` (like `OpenSpec (N) →`);
  - `useFolderMenuItem`: open / share / open standalone entries;
  - `shell-overlay-route` with `presentation: "content"`, `depth: 2`, `parentPath: "/folder/:encodedCwd"`, rendering the app.
  - Global apps (team `/team/`) use a `depth: 1` content claim; the plugin picks the entry point.
- **One app, two hosts.** An app is a React component that reaches its environment only through an `AppHost` contract. Inside the slot the plugin wraps it in `<EmbeddedApp>` (from `dashboard-plugin-runtime`), which provides the embedded host and the **board-style top bar**: Back · breadcrumb (folder › app) · the app's `HeaderContext` · app actions — the same layout as the OpenSpec board's top bar. Standalone, the plugin's own `/apps/<id>/` page mounts the same component with `createStandaloneHost()` and no dashboard chrome.
- **Contract unchanged** — consumes the existing `AppHost`, `defineDashboardApp`, `AppHostProvider`, `useAppHost`, `createStandaloneHost`, `<StandaloneBar>` from `@blackbelt-technology/pi-dashboard-app-kit/react`.
- **Navigation from an app** through the host: `openSession`, `openFolder`, `navigateDashboard` (validated same-origin path), `openStandalone` (named window, for a projector), `requestFullscreen`; a return pill brings the user back to the app.
- **No new route, no new manifest field name (one new `presentation` value + the `/*?` path form), no header extraction.** The sidebar and its header (π, theme, tunnel/zrok, YOLO, server, Discord, settings) stay exactly as they are, because the app renders beside them.

## Capabilities

### New Capabilities
- `plugin-embedded-app`: `<EmbeddedApp>` (embedded `AppHost` + board-style top bar), `HeaderContext` placement, host navigation and its validation, standalone parity, never-stranded states, embedding rules.

### Modified Capabilities
- `shell-overlay-route`: third presentation `"content"` (content area beside the sidebar; mobile detail panel at the claim's depth); trailing `/*?` wildcard in claim paths.
- `url-routing`: mobile depth of a `"content"` claim follows its declared `depth`.

## Discipline Skills

- **`security-hardening`** — embedded apps run in the dashboard's React tree with the operator's session (trusted plugins only); `navigateDashboard` path validation (defense-in-depth), encoded `openSession`/`openFolder`; embedded transport reuses the dashboard's bearer/cookie auth, standalone uses app-kit OIDC.
- **`doubt-driven-review`** — `AppHost` and `presentation: "content"` are public plugin API consumed by in-flight changes; review before they stand.
- **`performance-optimization`** — the generated registry imports plugin entries statically, so route components load app code with `React.lazy`; gate the dashboard's initial bundle before/after.
- **`review-code`** — before commit.
- Not triggered: `observability-instrumentation` beyond logging rejected navigations.

## Impact

- `packages/shared`: `PluginClaim.presentation` type (`manifest-types.ts`).
- `packages/dashboard-plugin-runtime`: `manifest-validator.ts`, Vite generator, `slot-registry.ts` (`ShellOverlayRouteClaim`), `slot-consumers.tsx` (`useShellOverlayRoutePresentation`, `/*?` matcher); new `<EmbeddedApp>` + embedded host.
- `packages/client`: `App.tsx` `pluginOverlayAsDialog` (`=== "dialog"`), background capture skips any plugin claim, `EmbeddedAppTransport` provider, mobile depth from the claim (`lib/layout/mobile-depth.ts`), back-target descriptor wildcard (`lib/nav/back-target.ts`), return pill.
- `packages/app-kit`: no change (consumed).
- Consumers: `add-voice-wall-plugin` (folder slot, menu, `/folder/:encodedCwd/wall/*?`), team plugin per `openspec/specs/team-app` (global `/team/*?` + folder route), `add-voice-assistant-dashboard-plugin` (links to the wall route; drops its live-target bridge).
- Compatibility: additive (new enum value + path form; existing claims unchanged). Rollback: revert consumer manifests using `"content"`/`/*?` first (unknown presentation is fatal), then remove `"content"`, the wildcard and `<EmbeddedApp>`; apps stay standalone at `/apps/<id>/`.
- Mockup: `mockups/` (in this change) — `embedded-app.html`, `dashboard/`, `ui-plan.md`.
