## Context

| | Wall (`add-voice-wall-plugin`) | Team (`add-team-plugin`) |
|---|---|---|
| Standalone URL | `/apps/wall/…` (share links `#/s/<token>`, projector) | `/apps/team/` (same origin, D14) or own deployment (`config.json` `dashboardUrl`, D11) |
| Scope | **folder** — a wall belongs to a meeting, a meeting to a folder (`projectRoot`); one live server-mic meeting per host (voice-assistant D16) | global (project selector inside the app) |
| Own header | meeting title · live dot · Present | project selector · language · sign-in |

How the dashboard shows a folder board today:
- **OpenSpec board** (core): folder pill `OpenSpec (N) →` (`FolderOpenSpecSection`, state-only) + folder-menu items (`openspec-archive`, `openspec-specs`) → `/folder/:encodedCwd/openspec`, rendered by `App.tsx` **in the content area beside the sidebar** with its own top bar (Back, breadcrumb, Refresh, Specs, Archive, New proposal).
- **Plugin boards** (Goals, KB, Automations): `sidebar-folder-section` pill + `useFolderMenuItem` + `shell-overlay-route` `/folder/:encodedCwd/<x>` with `depth: 2`, `parentPath`, `presentation` `"dialog"` (Dialog over a scrim) or `"page"` (full viewport).

React plugin client entries are bundled into the dashboard (`viteDashboardPluginsPlugin` → `generated/plugin-registry.tsx`), run in its React tree and are trusted.

## Goals / Non-Goals

Goals: plugin apps embed exactly like the OpenSpec board (folder slot + menu entries + content-area page, sidebar stays); one app source runs embedded and standalone; standalone shows no dashboard chrome; a round trip app ↔ dashboard never strands the user.

Non-goals: a separate full-screen app route or header (superseded first draft); iframes; untrusted apps (keep `LiveServerViewer`); split-pane embedding; a global app launcher (each plugin picks its own entry points; Team decides in its change).

## Decisions

**D1 — Reuse `shell-overlay-route`; add `presentation: "content"`.** The OpenSpec board placement — content area, sidebar visible, no scrim — is not available to plugins. Adding a third presentation value is the smallest change that gives it to every plugin, and keeps URL, deep-link, depth and back-target rules shared with `"dialog"` and `"page"`. Desktop: `App.tsx` renders the matched `"content"` claim in the same branch position as `renderOpenSpecBoardView` (live, never in a frozen underlay). Mobile: `MobileShell` detail panel at the claim's `depth`. `depth` is required for `"content"` (no dialog dismissal). Rejected: a new `/open/:appId/*` route with its own header frame (first draft) — duplicates the sidebar header and diverges from how the OpenSpec board works.

**D2 — Embedded apps are ordinary slot claims.** A plugin embeds its app with existing slots:
```json
"claims": [
  { "slot": "sidebar-folder-section", "component": "FolderWallEntry" },
  { "slot": "shell-overlay-route", "component": "WallRoute",
    "path": "/folder/:encodedCwd/wall", "depth": 2, "parentPath": "/folder/:encodedCwd", "presentation": "content" }
]
```
plus `useFolderMenuItem` entries from the client entry. The folder entry is state-only (`Live wall ● 00:14 →`), like `FolderOpenSpecSection`. Additional routes (e.g. `/folder/:encodedCwd/wall/:meetingId`) are further claims or handled by the app's own router under `basePath`.

**D3 — `AppHost` contract in `app-kit`.** One dependency for app authors; `app-kit` already abstracts "talk to a pi-dashboard host".
```ts
export interface AppHost {
  version: 1;
  mode: "embedded" | "standalone";
  basePath: string;                                   // "/folder/<enc>/wall" | "/apps/wall"
  folder?: { cwd: string; name: string };             // embedded folder-scoped apps
  capabilities: { dashboard: boolean; fullscreen: boolean; standaloneUrl?: string };
  api: { fetch(path: string, init?: RequestInit): Promise<Response>; wsUrl(path: string): Promise<string> };
  identity: { current(): Operator | null; subscribe(cb: () => void): () => void };
  theme: { current(): string; subscribe(cb: () => void): () => void };
  i18n: { language(): string; subscribe(cb: () => void): () => void };
  setTitle(title: string): void;
  setActions(actions: AppAction[]): void;
  openSession(id: string): void; openFolder(cwd: string): void; navigateDashboard(path: string): void;
  openStandalone(appPath?: string): void;
  requestFullscreen(el?: Element): void;
}
export interface AppAction { id: string; label: string; icon?: string; shortcut?: string; onSelect(): void }
export interface DashboardAppDefinition { id: string; title: string; App: React.ComponentType; HeaderContext?: React.ComponentType }
export function defineDashboardApp(d: DashboardAppDefinition): DashboardAppDefinition;
export function AppHostProvider(p: { host: AppHost; children: React.ReactNode }): JSX.Element;
export function useAppHost(): AppHost;
export function createStandaloneHost(o: { appId: string; basePath: string; config?: AppConfig }): Promise<AppHost>;
export function StandaloneBar(p: { app: DashboardAppDefinition }): JSX.Element;
```

**D4 — `<EmbeddedApp>` in `dashboard-plugin-runtime`.** Used inside the `shell-overlay-route` component:
```tsx
export function WallRoute({ params, onBack, pluginContext }: ShellOverlayRouteProps) {
  return <EmbeddedApp app={wallApp} basePath={`/folder/${params.encodedCwd}/wall`} folderParam={params.encodedCwd} onBack={onBack} pluginContext={pluginContext} />;
}
```
It builds the embedded host (dashboard auth for `api`, dashboard identity/theme/i18n, `folder` from the route, `setTitle` → the shell title) and renders the **board-style top bar** used by the OpenSpec board: Back (→ `onBack`) · breadcrumb `<folder> › <app title>` · the app's `HeaderContext` · ≤ 2 inline actions + overflow (from `setActions`) · *Open standalone ⧉* when `standaloneUrl` is set. Below it, the app inside a wouter `<Router base={basePath}>`, an error boundary and `Suspense`. Narrow (< 640 px): Back (icon) · `HeaderContext` · overflow, 44 px targets.

**D5 — Navigation.** Dashboard → app: links to the claim path (folder pill, folder menu, other plugins such as the copilot session header). App → dashboard: `openSession` / `openFolder` / `navigateDashboard` → history push; `navigateDashboard` accepts only `^/(?!/)` without scheme and not under `/apps/`; rejections logged. Return: browser Back; the destination shows a one-time **← <app> · <context>** return pill while the originating entry exists (`history.state.fromApp`). Second screen: `openStandalone()` → `window.open(standaloneUrl + appPath, "pi-app-<id>-<key>")`. Fullscreen: `requestFullscreen(el)` on the app element.

**D6 — Standalone.** The plugin serves `/apps/<id>/` (unchanged from the wall/team plans). `standalone.tsx` mounts `<AppHostProvider host={await createStandaloneHost(…)}><StandaloneBar app={app}/><app.App/></AppHostProvider>`. No dashboard sidebar, header, top bar or links; `capabilities.dashboard = false` makes navigation methods no-ops and apps hide those affordances.

**D7 — Embedding rules.** Route relative to `basePath`; no `window.location` writes; no global CSS on `html`/`body`/`:root` in the library entry; style with dashboard tokens; `document.title` via `setTitle`; key handlers scoped to the app root; storage keys prefixed `<appId>:`; data only via `host.api`; clean up on unmount; peer deps `react`, `react-dom`, `wouter` at dashboard ranges. Dev-mode warnings for title/body/history mutation.

**D8 — Two builds per app.** Library entry (imported by the plugin's client entry, bundled with the dashboard; lazy where the plugin's chunking allows) and standalone `index.html`. Monorepo apps release with the dashboard.

**D9 — States.** Inside `<EmbeddedApp>`: loading (Suspense) · running · crashed (boundary: message, Reload app, Back). Route-level: plugin disabled ⇒ claim absent ⇒ existing invalid-route fallback to `parentPath`; the folder pill and menu entries disappear with the plugin.

## Risks / Trade-offs

- [Trusted code in the operator's session] → React plugin entries already are; same as same-origin `/apps/<id>/`.
- [App CSS leaks into the dashboard] → D7; review gate on the library entry.
- [Content area is narrower than full screen] → acceptable for boards (OpenSpec precedent); fullscreen and *Open standalone* cover room screens.
- [`"content"` claims and the frozen underlay] → rendered live only, like the OpenSpec board branch (`!frozen`).

## Migration Plan

Land `extract-standalone-app-kit` with the D3 contract → this change → `add-voice-wall-plugin` adopts D2/D4 → `add-voice-assistant-dashboard-plugin` links to `/folder/<cwd>/wall`. Rollback: remove `"content"` and `<EmbeddedApp>`; apps stay standalone.

## Open Questions

- Electron `openStandalone`: new BrowserWindow vs `openExternal`.
- Return pill in the destination header vs a toast.
- Does the D3 contract land inside `extract-standalone-app-kit` or as a follow-up owned here?
- Team placement (global app): its change decides — e.g. `presentation: "content"` at a depth-1 path, or standalone only.
