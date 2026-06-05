# @blackbelt-technology/demo-plugin

**This package is a runtime fixture. It SHALL NOT ship in production builds.**

It exists solely to exercise the `dashboard-plugin-runtime` end-to-end:
- `settings-section` claim: renders a small settings form in the General tab.
- `tool-renderer` claim: renders `tool_call` events with `toolName: "DashboardDemo"` as a green box. Since `wire-tool-renderer-slot`, `ToolCallStep` consults plugin `tool-renderer` claims before the built-in registry, so this green box actually mounts in the chat surface when the `DashboardDemo` tool is invoked and this plugin is enabled.

## Usage in tests

```ts
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
// The demo plugin's claims appear automatically via discoverPlugins() in test environments
```

## Production exclusion

The manifest declares `"fixture": true`. The `viteDashboardPluginsPlugin` filters out fixture
plugins when `NODE_ENV=production`, so no demo code appears in release builds.

## Deletion policy

This package is deleted (or kept as a test fixture) once at least one `extract-*-as-plugin`
change ships and provides a real plugin for end-to-end runtime validation.

## Scaffolding your own plugin

This package is what the [`dashboard-plugin-scaffold`](../dashboard-plugin-skill/) skill produces — same layout, same manifest shape, same `usePluginConfig` / `usePluginSend` import paths. To create a new plugin, use the skill instead of copying this fixture:

```bash
npm i -g @blackbelt-technology/pi-dashboard-plugin-skill
# then in any pi session:
# /skill dashboard-plugin-scaffold
```
