# plugin-apps.md — index

Plugin React apps embedded + standalone. `<EmbeddedApp>` (`./embedded-app`), `EmbeddedAppShellProvider`, `EmbeddedAppReturnPill`, `isSafeDashboardPath`. Claim `presentation: "content"` + path `/*?`. Demo: `packages/demo-plugin`. See change: add-plugin-app-host. Project-scoped apps section: declared `.pi/dashboard/project.json`, manifest `projectTypes` markers, `GET /api/folder/project`, `useFolderProject` + `folderHasProjectType/Id` predicates, `<EmbeddedApp projectScope>`. See change: add-project-scoped-apps.

Also: runtime-loaded embedded apps (C on B): one app two builds (`dashboardClientViteConfig` + `dashboardStandaloneViteConfig`), host shims `embedded-app`/`app-kit-react`/`wouter`, `EmbeddedApp` claim in lazy chunk, canary `tests/fixtures/runtime-canary-plugin`. See change: decouple-plugins-from-core.
