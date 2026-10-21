## ADDED Requirements

### Requirement: Runtime-loaded plugins embed apps

An admitted runtime-loaded plugin SHALL be able to embed an app with the same claims and the same `<EmbeddedApp>` component as a bundled plugin, with no client rebuild. The import map SHALL expose host instances of `…/dashboard-plugin-runtime/embedded-app`, `…/pi-dashboard-app-kit/react` and `wouter`. `<EmbeddedApp>`, `useAppHost` and the app router then share one host context.

#### Scenario: Cold deep link into a runtime-loaded app
- **WHEN** a trusted runtime plugin claims `shell-overlay-route` `/s6/*?` with `presentation: "content"` and `depth: 1`, and the browser cold-loads `/s6/sub`
- **THEN** the app SHALL render its `/sub` route in the content area beside the sidebar
- **AND** it SHALL show the board-style top bar
- **AND** `host.mode` SHALL be `"embedded"`
- **AND** `host.api.fetch("/api/health")` SHALL succeed with the dashboard's authentication

#### Scenario: Same app runs standalone
- **WHEN** the plugin also mounts its standalone build with `serveApp` and the user opens `/apps/<id>/sub`
- **THEN** the same app SHALL render with `host.mode` `"standalone"` and `capabilities.dashboard: false`

#### Scenario: App bundling its own app-kit is contained
- **WHEN** a runtime plugin bundles its own copy of app-kit instead of using the import map
- **THEN** `useAppHost` SHALL fail inside the claim's error boundary, and the dashboard shell SHALL keep rendering
