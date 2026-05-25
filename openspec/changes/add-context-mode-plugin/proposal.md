## Why

`context-mode` is a pi extension package (registered in `~/.pi/agent/settings.json#packages[]` as `"npm:context-mode"`) whose `pi.extensions` entry points at `build/adapters/pi/extension.js`. At session start, the extension spawns its own MCP server (`server.bundle.mjs`), lists ~11 tools, and forwards each through `pi.registerTool()` so they enter pi's native tool registry: `ctx_execute`, `ctx_execute_file`, `ctx_search`, `ctx_batch_execute`, `ctx_fetch_and_index`, `ctx_index`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`. For the pi TUI it also ships `renderCall` / `renderResult` callbacks for nice terminal output.

The dashboard web client has its own React renderer stack and never sees those TUI render hooks. With no per-tool renderer registered for any `ctx_*` name, the dashboard's `getToolRenderer(name)` fall-through lands in `GenericToolRenderer`, which dumps `args` as raw JSON and `result` as plain text. Specifically:

- `ctx_batch_execute` — structured multi-command + multi-query payload becomes a nearly unreadable JSON wall.
- `ctx_execute` — code is the payload; lack of syntax highlighting is severe.
- `ctx_search` — queries + ranked hits structure hides the result entirely.

This change ships a new monorepo plugin, `pi-dashboard-context-mode-plugin`, that contributes one `tool-renderer` claim per `ctx_*` tool. The plugin auto-activates when the `context-mode` pi extension is installed (`requires.piExtensions: ["context-mode"]`), following the activation pattern proven by `honcho-plugin` and `subagents-plugin` in this same monorepo.

This change DEPENDS ON `wire-tool-renderer-slot` landing first — without that wiring, plugin tool-renderer claims are inert (`ToolCallStep` consults only the built-in registry).

## What Changes

- **New monorepo package** at `packages/context-mode-plugin/`, published as `pi-dashboard-context-mode-plugin`. Client-only — no server entry, no bridge entry, no REST routes.
- **Plugin manifest** declares `id: "context-mode"`, `displayName: "Context Mode"`, `priority: 100`, `client: "./src/client/index.tsx"`, `requires.piExtensions: ["context-mode"]`, and 11 `tool-renderer` claims (one per `ctx_*` tool).
- **Each claim specifies** `shouldRender: "ctxExtensionPresent"` — a sync exported function reading a module-level cache fed by `/api/health.plugins[].requirements.piExtensions`, refreshed on every `plugin-config-update` window event. Pattern copied verbatim from `honcho-plugin/src/client/hooks.ts` + `shouldRender.ts`.
- **Phase-1 bespoke renderers** (the three highest-value tools):
  - `CtxExecuteRenderer` — language pill, syntax-highlighted code block (re-using `ReadToolRenderer`'s SyntaxHighlighter), stdout panel (re-using `BashToolRenderer`'s pre block), "indexed: <intent>" badge when `args.intent` set, background-process pill when `args.background: true`.
  - `CtxBatchExecuteRenderer` — list of `{label, command}` chips (collapsible), separate list of `queries[]` chips, per-query result accordion, `concurrency` and `timeout` pills when set.
  - `CtxSearchRenderer` — one chip per query in `args.queries`, parsed hit list per query rendered as expandable cards with source label and snippet preview.
- **Phase-1 shared `CodeOutputCard`** (8 simpler renderers): `CtxExecuteFileRenderer` (path chip + language pill + code + output), `CtxFetchAndIndexRenderer` (URL pill(s) + source + preview), `CtxIndexRenderer` (source + content/path summary), `CtxStatsRenderer` (KPI grid: savings %, tokens, calls), `CtxDoctorRenderer` (status checklist), `CtxUpgradeRenderer` (single-line "command to run"), `CtxPurgeRenderer` (⚠ destructive callout + scope chip), `CtxInsightRenderer` ("opened insight dashboard at :<port>" pill).
- **Zero new visual primitives** — every renderer composes existing dashboard tokens (`var(--bg-secondary)`, `var(--text-secondary)`, `text-code`, etc.) and existing primitives lifted from `BashToolRenderer`, `ReadToolRenderer`, `EditToolRenderer`.
- **Graceful no-op** when `context-mode` extension is absent — `shouldRender: false` for every claim, dispatch falls through to `GenericToolRenderer` via the resolution chain from `wire-tool-renderer-slot`.

## Capabilities

### New Capabilities
- `pi-dashboard-context-mode-plugin`: the plugin manifest, slot claims, per-tool React renderers, `ctxExtensionPresent` sync cache, and graceful-hide behaviour when the `context-mode` pi extension is uninstalled.

### Modified Capabilities
- _None._ Plugin loads through the existing `dashboard-plugin-loader` capability without changing its requirements.

## Impact

- **Monorepo package**: `packages/context-mode-plugin/` published as `pi-dashboard-context-mode-plugin`. Part of the workspace npm publish flow alongside the other plugins.
- **Runtime dependencies**: `@blackbelt-technology/dashboard-plugin-runtime`, `@blackbelt-technology/pi-dashboard-shared`, `@mdi/js`, `@mdi/react`. `react-syntax-highlighter` only if the dashboard does not export a reusable wrapper (investigate during implementation; ideal to lift the dashboard's existing one).
- **Peer dependency**: React 19.
- **Activation**: zero user configuration. Adding `"npm:context-mode"` to `~/.pi/agent/settings.json#packages[]` and restarting the dashboard activates the plugin via the default-enabled-when-no-config behaviour (`cfg?.enabled !== false`). The Settings ▸ Plugins UI surfaces it. No manual toggle required.
- **Graceful degradation**: uninstalling `context-mode` while a session contains historical `ctx_*` calls in replayed history → plugin claims fall through to `GenericToolRenderer` (raw JSON dump). No errors, no console warnings, no flicker (closed-by-default cache).
- **Hard dependency**: `wire-tool-renderer-slot` must land first. Without it, the plugin loads but its claims are inert.
- **No server-side surface**: no plugin server entry, no REST routes, no `/api/plugins/context-mode/*` namespace.
- **No conflict** with the `unify-tool-renderer-code-font-size` change (separate, cosmetic font-size unification across built-in renderers). New plugin renderers will adopt the `text-code` utility class once that change merges.
