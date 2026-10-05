## ADDED Requirements

### Requirement: Plugin apps embed like the OpenSpec board
A plugin SHALL be able to embed a folder-scoped app using existing slots only: a state-only `sidebar-folder-section` entry, `useFolderMenuItem` entries, and a `shell-overlay-route` claim with `presentation: "content"`, `depth: 2` and `parentPath: "/folder/:encodedCwd"`. The app SHALL then render in the content area beside the sidebar, and the sidebar with its header controls SHALL stay visible and unchanged.

#### Scenario: Open from the folder entry
- **WHEN** the user activates the wall plugin's folder entry `Live wall ● 00:14 →` for folder `acme-erp`
- **THEN** the dashboard navigates to `/folder/<acme-erp>/wall`, the wall renders in the content area, and the sidebar still shows the folder's session cards and the header controls

#### Scenario: Back returns to the folder
- **WHEN** the user activates Back in the app's top bar
- **THEN** the dashboard returns to `/folder/<acme-erp>`

### Requirement: EmbeddedApp provides the host and a board-style top bar
`dashboard-plugin-runtime` SHALL export `<EmbeddedApp app basePath folderParam? onBack pluginContext>`. It SHALL provide an `AppHost` with `mode: "embedded"`, `capabilities.dashboard: true`, the given `basePath`, the decoded folder when `folderParam` is set, dashboard authentication for `api`, and dashboard identity, theme and language. It SHALL render a top bar laid out like the OpenSpec board's: Back, a breadcrumb `<folder> › <app title>`, the app's `HeaderContext` when defined, at most two inline actions from `setActions` with the rest in an overflow menu, and *Open standalone* when the host knows a standalone URL. The app SHALL render below the bar inside a router based at `basePath`, an error boundary and a `Suspense` boundary.

#### Scenario: HeaderContext in the top bar
- **WHEN** the wall defines a `HeaderContext` meeting chip and is embedded
- **THEN** the chip renders in the top bar between the breadcrumb and the actions

#### Scenario: Deep link reload
- **WHEN** the user reloads `/folder/<acme-erp>/wall/graph`
- **THEN** the wall renders its graph view in the content area

#### Scenario: App crash isolated
- **WHEN** the app throws during render
- **THEN** the boundary shows a message with Reload app and Back, and the sidebar keeps working

### Requirement: Host navigation is validated
`navigateDashboard(path)` SHALL navigate only when `path` starts with exactly one `/`, contains no scheme and is not under `/apps/`; otherwise it SHALL do nothing and log the rejection. `openSession` and `openFolder` SHALL navigate to the dashboard session or folder route. Each such navigation SHALL be a history push, and the destination SHALL show a return pill naming the app and its context until the user navigates elsewhere.

#### Scenario: App to session and back
- **WHEN** the embedded wall calls `openSession("abc")` and the user then activates the return pill
- **THEN** the dashboard shows session `abc` and then returns to the wall at the same app route

#### Scenario: Off-origin path refused
- **WHEN** an app calls `navigateDashboard("//evil.example/x")`
- **THEN** no navigation happens and a rejection is logged

### Requirement: The same app runs standalone without dashboard chrome
An app opened at its standalone URL (served by its plugin, e.g. `/apps/<id>/`) SHALL run with a host whose `mode` is `"standalone"` and `capabilities.dashboard` is `false`; it SHALL NOT render the dashboard sidebar, header or top bar, and dashboard navigation methods SHALL be no-ops. `openStandalone()` from the embedded app SHALL open the standalone URL at the same app route in a named window, focusing an existing one.

#### Scenario: Context URL shows no dashboard chrome
- **WHEN** a participant opens `/apps/wall/#/s/<token>`
- **THEN** the wall renders without the dashboard sidebar, header, top bar or links into the dashboard

#### Scenario: Projector window
- **WHEN** the operator activates Open standalone twice for the same meeting
- **THEN** one named window shows `/apps/wall/…` at the same app route and it is focused
