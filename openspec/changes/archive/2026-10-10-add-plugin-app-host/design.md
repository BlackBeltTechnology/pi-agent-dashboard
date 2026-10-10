## Context

| | Wall (`add-voice-wall-plugin`) | Team (`add-team-plugin`, archived; `openspec/specs/team-app`) |
|---|---|---|
| Standalone URL | `/apps/wall/…` (share links `#/s/<token>`, projector) | `/apps/team/` or own deployment (`config.json` `dashboardUrl`) |
| Scope | **folder** — a wall belongs to a meeting, a meeting to a folder (`projectRoot`) | **global** `/team/` + **folder** `/folder/<cwd>/team/` (`openspec/specs/team-app/spec.md` "Two hosts") |
| Own header | meeting title · live dot · Present | project selector (in the embedded top bar) |

How the dashboard shows a folder board today:
- **OpenSpec board** (core): folder pill `OpenSpec (N) →` (`FolderOpenSpecSection`, state-only) + folder-menu items → `/folder/:encodedCwd/openspec`, rendered by `renderOpenSpecBoardView` (`packages/client/src/App.tsx:2113`) **in the content area beside the sidebar** with its own top bar.
- **Plugin boards** (Goals, KB, Automations): `sidebar-folder-section` pill + `useFolderMenuItem` + `shell-overlay-route` `/folder/:encodedCwd/<x>` with `depth: 2`, `parentPath`, `presentation` `"dialog"` or `"page"`.

How `shell-overlay-route` claims render today:
- `App.tsx:2190` `pluginOverlayAsDialog = pluginOverlayMatched && pluginOverlayPresentation !== "page"` — every non-`"page"` claim is lifted into the dialog (mount `:3259`, scrim + frozen underlay). `:2183` skips `captureBackground` only while `pluginOverlayAsDialog`.
- Desktop content-area mount `App.tsx:3090`, gated by `!pluginOverlayAsDialog`, renders a claim in place of `ShellContent` — beside the sidebar.
- Mobile: `"page"` returns full-viewport before `MobileShell` (`:2968`); otherwise the claim renders in the detail panel (`:3029`) at `getMobileDepth(...)`, which returns 2 whenever `hasOverlayRoute` (`packages/client/src/lib/layout/mobile-depth.ts:39`), and `hasShellOverlayRoute` includes every plugin claim.
- Claim matching: `useShellOverlayRouteMatched` (`slot-consumers.tsx:844`), `useShellOverlayRoutePresentation` (`:881`, returns `"page" | "dialog" | null`) and the sync first-render path all use `matchWouterPatternWithParams` (`:913`): exact segment count, `:param` only. Per-claim probes use wouter `useRoute`. Back-target classifier `matchPattern` (`packages/client/src/lib/nav/back-target.ts:123`) accepts a bare trailing `*` (≥ 0 rest segments) but not `*?`.
- Validator: `manifest-validator.ts:193-199` makes an unknown `presentation` fatal; `:314-315` copies only `"page"`/`"dialog"` into the normalised claim; missing `depth` only warns (`:172-177`).
- Generated registry (`packages/client/src/generated/plugin-registry.tsx`) imports plugin client entries statically.

The `AppHost` contract already exists: `packages/app-kit/src/react/app-host.tsx` (subpath `@blackbelt-technology/pi-dashboard-app-kit/react`) exports `AppHost`, `AppAction`, `DashboardAppDefinition`, `defineDashboardApp`, `AppHostProvider`, `useAppHost`, `useOptionalAppHost`, `useHostValue`, `createStandaloneHost`, `StandaloneBar` (archived `extract-standalone-app-kit` / `add-team-plugin` D16). Its header comment assigns the embedded host to this change; `packages/team-app/src/team-app.tsx:3` already documents `<EmbeddedApp app={teamApp}>`.

Dashboard client auth: a paired-device or identity bearer (`getApiBearer()`, `packages/client/src/lib/pairing/device-auth.ts:124`) or cookie/loopback; sockets mint a single-use ticket via `mintWsTicket` (`device-auth.ts:186`) only when a bearer exists (`packages/client/src/hooks/useWebSocket.ts:266-275`).

Electron: `setWindowOpenHandler` sends **every** `window.open` URL to `shell.openExternal` (`packages/electron/src/main.ts:510-513`).

## Goals / Non-Goals

Goals: plugin apps embed exactly like the OpenSpec board (entry + content-area page, sidebar stays); one app source runs embedded and standalone; standalone shows no dashboard chrome; a round trip app ↔ dashboard never strands the user; satisfy `team-app` "Two hosts" (global + folder content routes, deep links).

Non-goals: a separate full-screen app route or header (superseded first draft); iframes; untrusted apps (keep `LiveServerViewer`); split-pane embedding; a global app launcher; changes to the `AppHost` interface; fixing pre-existing drift (≤ 2 slot mounts; `"page"` depth only warns).

## Decisions

**D1 — Reuse `shell-overlay-route`; add `presentation: "content"`; reuse existing mounts.** Smallest change that gives every plugin the OpenSpec-board placement while sharing URL, deep-link, depth and back-target rules. No new `<ShellOverlayRouteSlot>` mount.
- `App.tsx:2190` → `pluginOverlayAsDialog = pluginOverlayMatched && pluginOverlayPresentation === "dialog"` (hook already maps an omitted value to `"dialog"`). A `"content"` claim falls to the desktop content-area mount `:3090`.
- Background capture (`:2183`): skip `captureBackground` for matched `"dialog"` **and** `"content"` claims (`"page"` unchanged: still captured), so a content page never freezes itself as an underlay and never resets launchers. Consequence: a dialog opened from a content page uses the last non-plugin background (e.g. the folder) as underlay — same as a dialog opened from a dialog today. Accepted.
- Types widen to `"page" | "dialog" | "content"`: `PluginClaim` (`packages/shared/src/dashboard-plugin/manifest-types.ts`), `ShellOverlayRouteClaim` (`slot-registry.ts`), `useShellOverlayRoutePresentation`, validator check (`:193-199`) **and** normalisation copy (`:314-315`), Vite generator.
- `"content"` requires `depth` (fatal when missing; `"page"` keeps today's warning — out of scope).
- Mobile: detail panel (`:3029`). `getMobileDepth` gains `overlayDepth?: 1 | 2`; when the matched claim is `"content"`, App passes its declared depth and that wins over the `hasOverlayRoute ⇒ 2` rule. `"dialog"` claims keep depth 2 (existing behaviour unchanged). Modifies `url-routing` "Mobile depth derives from route matches".
- No `Esc`/backdrop dismissal: Back = the shell's `goBack` (`App.tsx:1882` → `lib/nav/history-back.ts`): when the tracked predecessor is shallower it is `history.back()` (where the user came from — satisfies team-app "Back SHALL return to where the user came from"), else it navigates to the descriptor target (interpolated `parentPath`, or `/` for a depth-1 claim).
Rejected: a new `/open/:appId/*` route with its own header (first draft).

**D2 — Embedded apps are ordinary slot claims; trailing `/*?` for sub-routes.**
```json
"claims": [
  { "slot": "sidebar-folder-section", "component": "FolderWallEntry" },
  { "slot": "shell-overlay-route", "component": "WallRoute",
    "path": "/folder/:encodedCwd/wall/*?", "depth": 2, "parentPath": "/folder/:encodedCwd", "presentation": "content" }
]
```
plus `useFolderMenuItem` entries. Only a literal trailing `/*?` (wouter/regexparam optional wildcard) is accepted; any other `*` (including trailing `/*`) is fatal. One shared matcher in `slot-consumers.tsx` serves `useShellOverlayRouteMatched`, `useShellOverlayRoutePresentation` and the sync params path, so App-level gating agrees with the wouter probe. The matcher normalises an absent wildcard capture to `params["*"] = ""` (wouter yields `undefined`); the slot consumer applies the same normalisation to probe params. `back-target.ts` `matchPattern` treats `*?` as "≥ 0 rest segments" and `literalSegmentCount` excludes `*?` from the specificity score (as it does `*`), so a wildcard claim never outranks a core descriptor; a test resolves `/folder/x/wall/graph` against the core descriptor table. Tests pin the behaviour against installed wouter; `dashboard-plugin-runtime` wouter peer range rises to `^3.9.0` (client's range). Global app: depth-1 claim (`/team/*?`, `depth: 1`, no `parentPath`).

**D3 — Consume the existing `AppHost` contract unchanged.** `packages/app-kit/src/react/app-host.tsx` is the contract (incl. `api.wsUrl(path: string): Promise<string | null>`, optional `theme.set` / `i18n.set`, `folder?: { cwd; name }`). Imports from the `/react` subpath (root stays React-free per `standalone-app-kit` "Product-neutral, publishable package").

**D4 — `<EmbeddedApp>` in `dashboard-plugin-runtime`.**
```tsx
export function WallRoute({ params, onBack, pluginContext }: ShellOverlayRouteProps) {
  return <EmbeddedApp app={wallApp} basePath={`/folder/${params.encodedCwd}/wall`} folderParam={params.encodedCwd} onBack={onBack} pluginContext={pluginContext} />;
}
```
Props `app`, `basePath`, `onBack` required; `folderParam`, `standaloneUrl`, `pluginContext` optional (matches the `team-app.tsx:3` usage plus routing inputs).
- **Shell services injected by the client.** `dashboard-plugin-runtime` cannot import client code, so `App.tsx` mounts a runtime context provider supplying `EmbeddedAppShell = { fetch, wsUrl, encodeFolder, decodeFolder, returnTarget }`. `fetch(path)` / `wsUrl(path)` accept only root-relative, scheme-free paths (same character rules as `navigateDashboard`) and reject anything else (rejected promise / `null`) — the dashboard bearer never leaves the origin. (Deliberately stricter than app-kit's standalone transport, which passes absolute URLs through per `standalone-app-kit` "Runtime dashboard endpoint"; that requirement governs the kit, not this shell transport.) `fetch` adds the dashboard's auth (`Authorization: Bearer` when `getApiBearer()` is set, else cookie/loopback); `wsUrl` appends `mintWsTicket("browser")` when `getApiBearer() || isDevicePaired()` — the exact predicate of `useWebSocket.ts:266-275`. `encodeFolder`/`decodeFolder` = the core helpers in `packages/client/src/lib/util/folder-encoding.ts` (the ones the `/folder/:encodedCwd` route uses; plugin copies are not used). Missing provider ⇒ `<EmbeddedApp>` renders its error state.
- Host: `mode: "embedded"`, `capabilities.dashboard: true`, `capabilities.fullscreen = document.fullscreenEnabled`, `capabilities.standaloneUrl` = the optional `standaloneUrl` prop the plugin route passes, e.g. `/apps/wall/` (absent ⇒ no *Open standalone*); identity/theme/i18n from dashboard contexts; `folder = { cwd: decodeFolderPath(folderParam), name: basename(cwd) }`; `folderParam` that fails to decode ⇒ "Folder not found" state with Back; `setTitle` → shell title.
- Top bar (OpenSpec-board layout): Back (→ `onBack`) · breadcrumb `<folder name> › <app title>` (just `<app title>` without folder) · app `HeaderContext` · ≤ 2 inline actions + overflow (`setActions`) · *Open standalone ⧉* when `standaloneUrl` set. Below: app inside wouter `<Router base={basePath}>`, error boundary, `Suspense`. Narrow (< 640 px): Back (icon) · `HeaderContext` · overflow, 44 px targets.

**D5 — Navigation.** Dashboard → app: links to the claim path. App → dashboard via wouter `navigate` (push; never `window.location`):
- `openSession(id)` → `/session/${encodeURIComponent(id)}`; `openFolder(cwd)` → `/folder/${encodeFolder(cwd)}`. These build their own path and do not go through `navigateDashboard`; a decoded id that matches no session hits the existing unknown-session redirect to `/` (`App.tsx:1327-1331`).
- `navigateDashboard(path)` accepts only: starts with exactly one `/`; no `\`, whitespace or control char; no scheme; no `.`/`..` segment after decoding; first segment not `apps`. Else no navigation + `console.warn` naming the app. Rationale: defense-in-depth — wouter `navigate` is `pushState`, which already throws cross-origin; the rules stop apps reaching `/apps/*` or malformed shell routes.
- **Return pill (in-memory, not `history.state`).** Before navigating, the host records `returnTarget = { appId, title, context, href, dest }` (`context` = the app's last `setTitle()` value, else the folder name, else empty; an empty context drops the ` · <context>` part) (`href` = app's full current path, `dest` = destination path) in a runtime store. The shell shows **← <title> · <context>** while the location equals `dest`; activating it **pushes** `href` (not `history.back()`, so destination-side pushes or a fresh tab cannot misroute) and clears the target; any location change to a path ≠ `dest` clears it. One target at a time (a newer app navigation replaces it); lost on reload; the push adds one history entry — all accepted.
- `openStandalone(appPath?)`: `appPath` must start with `/` or `#` and pass the `navigateDashboard` character rules (else no-op + warn); → `window.open(standaloneUrl + (appPath ?? <current path relative to basePath>), "pi-app-<appId>")` (one named window per app → reused). Apps whose standalone router is hash-based pass `appPath` themselves (e.g. wall `#/s/<token>`). In Electron every `window.open` goes to `shell.openExternal` (`main.ts:510-513`): the system browser opens the URL; named-window reuse does not apply there, and the standalone app signs in through app-kit (the Electron session's bearer is not shared).
- `requestFullscreen(el)` on the app element.

**D6 — Standalone.** Plugin serves `/apps/<id>/`. `standalone.tsx` mounts `<AppHostProvider host={await createStandaloneHost(…)}><StandaloneBar app={app}/><app.App/></AppHostProvider>` (existing app-kit). `capabilities.dashboard = false` ⇒ navigation no-ops (existing behaviour; asserted by test).

**D7 — Embedding rules.** Route relative to `basePath`; no `window.location` writes; no global CSS on `html`/`body`/`:root` in the library entry; dashboard tokens; `document.title` via `setTitle`; key handlers scoped to the app root; storage keys prefixed `<appId>:`; data only via `host.api`; clean up on unmount; peer deps `react`, `react-dom`, `wouter` at dashboard ranges. Dev-mode warnings for title/body/history mutation.

**D8 — Two builds per app; app code lazy.** Library entry + standalone `index.html`. The generated registry imports client entries statically, so the plugin's client entry exports the route component as `React.lazy(() => import("./WallRoute"))`; that module imports the app definition and renders `<EmbeddedApp>` (as in D4), so app code lands in its own Vite chunk. The slot consumer renders a `"content"` claim inside a `Suspense` boundary (top-bar-shaped skeleton) to cover the lazy load. Gate: dashboard initial bundle size before/after this change + one fixture app, within +5 KB gzip (runtime + shell code only).

**D9 — States.** Inside `<EmbeddedApp>`: loading (Suspense) · running · crashed (boundary: message, Reload app, Back) · folder not found · no transport. Plugin disabled ⇒ claim absent ⇒ the URL is handled like any unmatched URL today (`openspec/specs/url-routing/spec.md`); no new fallback. Folder entry and menu items disappear with the plugin.

## Risks / Trade-offs

- [Trusted code in the operator's session] → React plugin entries already are; same as same-origin `/apps/<id>/`.
- [App CSS leaks into the dashboard] → D7; review gate on the library entry.
- [Content area narrower than full screen] → acceptable (OpenSpec precedent); fullscreen and *Open standalone* cover room screens.
- [Forward compatibility] → a plugin declaring `"content"` or `/*?` fails validation on an older dashboard (unknown presentation is fatal by design). Monorepo plugins release with the dashboard; third-party plugins declare the minimum dashboard version in their peer range. Accepted.
- [Global app entry point] → no global sidebar entry slot exists; a global app (team `/team/`) is reachable from its own links/menu items until such a slot lands (team-app's entry is conditional on it). Accepted.
- [Wildcard matcher diverges from wouter] → only trailing `/*?`; tests compare shared matcher vs `useRoute` on the same inputs.
- [Pre-existing spec drift: ≤ 2 slot mounts (App has 4); `"page"` depth warns though spec says required] → untouched; this change adds no mount.

## Migration Plan

`AppHost` + standalone host already landed. This change → `add-voice-wall-plugin` adopts D2/D4 → `add-voice-assistant-dashboard-plugin` links to `/folder/<cwd>/wall` → team plugin registers its embedded routes (team-app "No app host" until then).

Rollback order: revert consumer manifests declaring `"content"` or `/*?` **first**, then remove `"content"`, the wildcard, the transport provider and `<EmbeddedApp>`; apps stay standalone at `/apps/<id>/`.

## Open Questions

None.
