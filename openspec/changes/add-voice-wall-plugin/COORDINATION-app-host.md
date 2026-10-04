# Coordination note — plugin app host (from `add-plugin-app-host`)

Written by the `add-plugin-app-host` session. Nothing else in this change was edited. Read, decide, fold into your own artifacts, then delete this file.

> **Revised:** the earlier version of this note proposed a full-screen `/open/wall/*` route with its own header. That is **superseded**. The user decided that apps embed **like the OpenSpec board**: a folder slot + menu entries + a page in the content area beside the sidebar.

## Decision (user)

The wall belongs to a meeting, and a meeting belongs to a folder. So the wall is embedded in the dashboard as a **folder app**:

- **Folder slot:** `sidebar-folder-section`, a state-only entry like `OpenSpec (N) →`, for example `● Live wall →` while a wall runs for that folder.
- **Folder-menu entries:** `useFolderMenuItem`, group *open*: *Live wall*, *Open wall standalone* (projector), *Share live wall…* (the last one is already in your plan).
- **Page:** `shell-overlay-route` at `/folder/:encodedCwd/wall`, with `depth: 2`, `parentPath: "/folder/:encodedCwd"` and the new **`presentation: "content"`**. It renders in the content area beside the sidebar, exactly where the OpenSpec board renders. The sidebar and its header (π, theme, zrok, YOLO, server, Discord, settings) stay visible.
- **Standalone** (`/apps/wall/…`: share links, projector) is unchanged and shows **no** dashboard chrome.

The voice-assistant plugin no longer has its own "View live wall" menu item. It only links to `/folder/<cwd>/wall` from the copilot session header and the meeting toast.

## Contract — see `openspec/changes/add-plugin-app-host/`

Files: `proposal.md`, `design.md` D1–D9, `specs/plugin-embedded-app/spec.md`, the `specs/shell-overlay-route/spec.md` delta, and `mockups/embedded-app.html` (it uses the wall as its example).

- **`presentation: "content"`** is a new third value for `shell-overlay-route`: content area on desktop, the `MobileShell` detail panel on mobile.
- **`<EmbeddedApp app basePath folderParam onBack pluginContext>`** comes from `dashboard-plugin-runtime`. Use it inside your route component. It provides the embedded host and a top bar laid out like the OpenSpec board's: Back · breadcrumb `<folder> › Live wall` · your `HeaderContext` · ≤ 2 actions · *Open standalone*.
- **`AppHost`** (in `app-kit`):
  - fields: `mode`, `basePath`, `folder`, `capabilities.dashboard`, `api.fetch` / `wsUrl`, `identity`, `theme`, `i18n`;
  - methods: `setTitle`, `setActions`, `openSession` / `openFolder` / `navigateDashboard`, `openStandalone`, `requestFullscreen`;
  - helpers: `defineDashboardApp({ id, title, App, HeaderContext? })`, `createStandaloneHost()`, `<StandaloneBar>`.

## Suggested impact on this change (your call)

- **Manifest:** today it's `claims: []` and server-only. Add a client entry with:
  - a `sidebar-folder-section` claim (state-only `● Live wall →`, rendered only while a wall runs for that folder);
  - `useFolderMenuItem` entries;
  - a `shell-overlay-route` claim `{ path: "/folder/:encodedCwd/wall", depth: 2, parentPath: "/folder/:encodedCwd", presentation: "content" }` that renders `<EmbeddedApp app={wallApp} …/>`.
- **Wall app:** a library entry (default export `defineDashboardApp`, no `createRoot`, no global CSS on `html` / `body` / `:root`), plus the existing standalone `index.html` (`createStandaloneHost` + `StandaloneBar`).
- **Header split:**
  - the meeting title + live dot become `HeaderContext`;
  - *Present* becomes a `setActions` entry (`host.requestFullscreen(el)`);
  - the viewer strip / *Sign in to type* stays standalone-only, because the operator is already signed in when embedded.
- **Data:** only through `host.api`. Embedded uses dashboard auth; standalone uses the share-token header.
- **CSP:** when embedded, the dashboard's CSP applies, not your `/apps/wall/` CSP. Rendering event text as text, never as HTML, becomes the only XSS barrier.
- **Navigation:** turn or speaker links call `host.openSession(copilotSessionId)`. Hide them when `capabilities.dashboard` is false.
- **Share dialog:** *Present on this screen* can use `host.openStandalone("m/<id>")` when embedded.
- **Dependency:** `add-plugin-app-host` is optional; without it the wall is standalone only.
- **Superseded in your `ui-plan.md` §6:** "*View live wall* opens `/apps/wall/` (a new tab or the split viewer)" now means the folder page.

## Decided since (user): no meeting running

- **Folder tile:** hidden. Only the voice-assistant MEETINGS tile shows, with *Start meeting…* in the folder menu.
- **`/folder/<cwd>/wall` with no wall** (a stale link or reload): render an **empty state** instead of redirecting:
  - **No live meeting**;
  - **Start meeting…**, which opens voice-assistant's start dialog;
  - **the last meeting's wall, read-only**, replayed from `docs/meetings/<date>-<slug>.wall.jsonl`, which voice-assistant's archive step copies from the runtime dir (its D19, task 4.4 step 6a).
- The route claim must therefore stay registered whenever the plugin is enabled, not only while a wall runs.

## Open questions where your input helps

- Route shape: `/folder/:encodedCwd/wall` for the current meeting, plus `/wall/:meetingId`? Or the meeting id only inside the app's router?
