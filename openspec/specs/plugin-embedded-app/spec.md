# plugin-embedded-app Specification

## Purpose
Plugins embed their own React apps in the dashboard content area beside the sidebar, OpenSpec-board style, using existing slots: `<EmbeddedApp>` (dashboard-plugin-runtime `./embedded-app`) provides the embedded app-kit `AppHost`, a board-style top bar, validated host navigation and a return pill, while the same app runs standalone at its plugin-served URL without dashboard chrome.

## Requirements

### Requirement: Plugin apps embed like the OpenSpec board
A plugin SHALL be able to embed an app using existing slots only. A folder-scoped app SHALL use a state-only `sidebar-folder-section` entry, `useFolderMenuItem` entries, and a `shell-overlay-route` claim with `presentation: "content"`, `depth: 2` and `parentPath: "/folder/:encodedCwd"`. A global app SHALL use a `shell-overlay-route` claim with `presentation: "content"` and `depth: 1`. Claim paths MAY end in `/*?` so the app's sub-routes match the same claim. The app SHALL then render in the content area beside the sidebar, and the sidebar with its header controls SHALL stay visible and unchanged.

#### Scenario: Open from the folder entry
- **WHEN** the user activates the wall plugin's folder entry `Live wall ● 00:14 →` for folder `acme-erp`
- **THEN** the dashboard navigates to `/folder/<acme-erp>/wall`, the wall renders in the content area, and the sidebar still shows the folder's session cards and the header controls

#### Scenario: Back returns to the folder
- **WHEN** the user activates Back in the app's top bar
- **THEN** the dashboard returns to `/folder/<acme-erp>`

#### Scenario: Global app at depth 1
- **WHEN** a plugin claims `/team/*?` with `presentation: "content"` and `depth: 1`, and the user opens `/team/`
- **THEN** the app renders in the content area beside the sidebar, the breadcrumb shows only the app title, and Back returns to `/`

### Requirement: EmbeddedApp provides the host and a board-style top bar
`dashboard-plugin-runtime` SHALL export `<EmbeddedApp app basePath folderParam? standaloneUrl? onBack pluginContext?>`; `capabilities.standaloneUrl` SHALL equal the `standaloneUrl` prop, and without it no *Open standalone* affordance SHALL render. It SHALL provide the app-kit `AppHost` (unchanged interface) with `mode: "embedded"`, `capabilities.dashboard: true`, the given `basePath`, the decoded folder when `folderParam` is set, an `api` that carries the dashboard's authentication and accepts only root-relative, scheme-free paths (any other URL is rejected without a request), and dashboard identity, theme and language. It SHALL render a top bar laid out like the OpenSpec board's: Back, a breadcrumb `<folder> › <app title>` (only `<app title>` without a folder), the app's `HeaderContext` when defined, at most two inline actions from `setActions` with the rest in an overflow menu, and *Open standalone* when the host knows a standalone URL. The app SHALL render below the bar inside a router based at `basePath`, an error boundary and a `Suspense` boundary.

#### Scenario: HeaderContext in the top bar
- **WHEN** the wall defines a `HeaderContext` meeting chip and is embedded
- **THEN** the chip renders in the top bar between the breadcrumb and the actions

#### Scenario: Deep link reload
- **WHEN** the wall claims `/folder/:encodedCwd/wall/*?` and the user reloads `/folder/<acme-erp>/wall/graph`
- **THEN** the wall renders its graph view in the content area

#### Scenario: Dashboard credentials never leave the origin
- **WHEN** an embedded app calls `host.api.fetch("https://evil.example/x")` or `host.api.wsUrl("//evil.example/ws")`
- **THEN** no request is made, the fetch rejects and `wsUrl` resolves to `null`

#### Scenario: App crash isolated
- **WHEN** the app throws during render
- **THEN** the boundary shows a message with Reload app and Back, and the sidebar keeps working

### Requirement: Host navigation is validated
`navigateDashboard(path)` SHALL navigate only when `path` starts with exactly one `/`, contains no `\`, whitespace or control character, contains no scheme, has no `.` or `..` segment after decoding, and is not under `/apps/`; otherwise it SHALL do nothing and log the rejection. `openSession(id)` and `openFolder(cwd)` SHALL navigate to the dashboard session or folder route with the argument encoded, never interpolated raw. Each such navigation SHALL be a history push through the dashboard router (no `window.location` write). Before navigating, the host SHALL record a return target (app, context, the app's current path, the destination path). While the location equals that destination the shell SHALL show a return pill `← <app title> · <context>`, where the context is the app's last `setTitle()` value, else the folder name, else omitted together with its separator; activating it SHALL push the recorded app path and clear the target, and navigating to any other path SHALL clear it.

#### Scenario: App to session and back
- **WHEN** the embedded wall calls `openSession("abc")` and the user then activates the return pill
- **THEN** the dashboard shows session `abc` and then returns to the wall at the same app route

#### Scenario: Return pill does not rely on history.back
- **WHEN** the wall at `/folder/<acme-erp>/wall/graph` calls `openSession("abc")` in a tab whose previous history entry is not the wall, and the user activates the return pill
- **THEN** the dashboard navigates to `/folder/<acme-erp>/wall/graph`

#### Scenario: Return pill cleared elsewhere
- **WHEN** the wall calls `openSession("abc")` and the user then opens `/settings`
- **THEN** no return pill is shown on `/settings`

#### Scenario: Off-origin path refused
- **WHEN** an app calls `navigateDashboard("//evil.example/x")` or `navigateDashboard("/\\evil.example/x")`
- **THEN** no navigation happens and a rejection is logged

#### Scenario: Session id is encoded
- **WHEN** an app calls `openSession("a/../../apps/x")`
- **THEN** the dashboard navigates to `/session/a%2F..%2F..%2Fapps%2Fx`, not to any `/apps/` path

### Requirement: The same app runs standalone without dashboard chrome
An app opened at its standalone URL (served by its plugin, e.g. `/apps/<id>/`) SHALL run with a host whose `mode` is `"standalone"` and `capabilities.dashboard` is `false`; it SHALL NOT render the dashboard sidebar, header or top bar, and dashboard navigation methods SHALL be no-ops. `openStandalone(appPath?)` from the embedded app SHALL open the standalone URL at `appPath`, defaulting to the current path relative to `basePath`, in a window named per app, so a repeated call reuses that window. In the Electron shell, where every `window.open` is handed to the system browser, the call SHALL open the URL in the system browser and SHALL NOT create a secondary `BrowserWindow`.

#### Scenario: Context URL shows no dashboard chrome
- **WHEN** a participant opens `/apps/wall/#/s/<token>`
- **THEN** the wall renders without the dashboard sidebar, header, top bar or links into the dashboard

#### Scenario: Projector window
- **WHEN** the operator activates Open standalone twice for the same meeting in a browser
- **THEN** both calls target the same window name and standalone URL `/apps/wall/…` at the same app route
