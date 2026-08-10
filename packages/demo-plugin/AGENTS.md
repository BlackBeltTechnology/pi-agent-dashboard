# DOX — packages/demo-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Runtime fixture plugin; SHALL NOT ship in production builds. Exercises `dashboard-plugin-runtime` end-to-end: `settings-section` claim (settings form in General tab), `tool-renderer` claim (renders `tool_call` with `toolName: "DashboardDemo"` as green box). Discovered via `discoverPlugins()` in test environments. |
