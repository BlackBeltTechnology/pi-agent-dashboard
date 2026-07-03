# DOX — packages/demo-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `client.tsx` | Demo plugin client fixture (dev/test only). Exports `DemoSettings` (SettingsPanel tab, edits `DemoConfig` greeting/count, sends `plugin_config_write`) + `DemoToolRenderer` (renders `DashboardDemo` tool calls). Uses `usePluginConfig`/`usePluginSend` from dashboard-plugin-runtime context. |
