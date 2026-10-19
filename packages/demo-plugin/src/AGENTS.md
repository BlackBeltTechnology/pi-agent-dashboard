# DOX — packages/demo-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `client.tsx` | Demo plugin client fixture (dev/test only). Exports `DemoSettings` (SettingsPanel tab, edits `DemoConfig` greeting/count, sends `plugin_config_write`) + `DemoToolRenderer` (renders `DashboardDemo` tool calls). Uses `usePluginConfig`/`usePluginSend` from dashboard-plugin-runtime context. `DemoSettings` gains `DemoSignIn` (`demo-oauth`, `demo-oauth-start`, `demo-oauth-account`, `demo-oauth-outcome`): POST sign-in, polls `oauthFlowClient`, renders `ui:oauth-flow`. See change: expose-plugin-credential-and-oauth-seams. Exports `DemoAppRoute = lazy(() => import("./demo-app/DemoAppRoute.js"))` for content claim `/folder/:encodedCwd/demo-app/*?`. See change: add-plugin-app-host. Adds `DemoScopedAppRoute` (lazy), `isDemoScopedFolder = folderHasProjectType("demo-scoped")`, `DemoScopedFolderEntry`. See change: add-project-scoped-apps. Exports `DemoDocxHandler` (stub textarea for the `editor-pane-file-handler` `.docx` edit claim `demo/docx`: `data-instance-id`, `window.__demoHandlerMounts`, calls `setDirty`). See change: add-editor-pane-file-handlers. |
| `demo-app/DemoAppRoute.tsx` | Lazy route module (default export) rendering `<EmbeddedApp app={demoApp} basePath=/folder/<enc>/demo-app folderParam>`. Own Vite chunk. See change: add-plugin-app-host. |
| `demo-app/fixture-app.tsx` | Fixture app `demoApp` (id `demo`, title `Demo`): views `/` + `/sub`, session-id input + `open session` (`host.openSession`), `setTitle("Demo ctx")`. Reached only via `DemoAppRoute` dynamic import. See change: add-plugin-app-host. |
| `demo-scoped-app/DemoScopedAppRoute.tsx` | Lazy route (default export) rendering `<EmbeddedApp projectScope={{ type: "demo-scoped" }}>` at `/folder/<enc>/demo-scoped`; no standalone URL. See change: add-project-scoped-apps. |
| `demo-scoped-app/scoped-app.tsx` | Fixture app `demoScopedApp` (id `demo-scoped`): views `/` + `/sub`. See change: add-project-scoped-apps. |
