# Design — grammar as a fully self-contained plugin

## Current coupling (what must leave core)

| Layer | File | Grammar code today |
|---|---|---|
| Client | `client/src/App.tsx` | imports + mounts `GrammarPanel`, calls `useGrammarCheck` |
| Client | `client/src/components/chat/CommandInput.tsx` | composer wiring (draft → check) |
| Client | `client/src/components/chat/GrammarPanel.tsx`, `hooks/useGrammarCheck.ts` | the UI + hook |
| Server | `server/src/server.ts` | `registerGrammarRoutes(fastify, { getModelRegistry, streamSimple, … })` |
| Server | `server/src/routes/grammar-routes.ts`, `server/src/grammar/**` | routes + backends |
| Shared | `shared/src/config.ts`, `shared/src/grammar-types.ts` | `GrammarConfig`, result types |

Target: all of the above lives in the plugin; core keeps only the **generic** extension points
below.

## Gap 1 — composer slot (client extension point)

The slot catalog (`dashboard-shell-slots`) has no composer surface. Grammar needs to (a) observe
the current draft as the user types and (b) render a panel adjacent to the input.

**Decision:** add ONE general slot `composer-panel` rendered by `CommandInput.tsx` below the input,
and pass slot components a **read-only composer context** `{ draft: string, language?: string }`
via the existing slot-props mechanism. The slot component owns its own debounce/side-effects (the
plugin ports `useGrammarCheck` verbatim). Core renders whatever claims the slot; it does NOT know
about grammar.

- Rejected: a grammar-specific `grammar-panel` slot — violates "capabilities are general."
- Rejected: exposing a mutable draft setter now — grammar only needs read + an "apply correction"
  action, which routes through the existing action-dispatch, not a new mutation API.

## Gap 2 — model runtime in `ServerPluginContext`

`registerGrammarRoutes` is handed `getModelRegistry` + `streamSimple` by `server.ts`. A plugin
`server` entry gets `ServerPluginContext`, which today lacks these.

**Decision:** extend `ServerPluginContext` with `modelRuntime?: { getModelRegistry(): Promise<…>;
streamSimple: LlmStreamFn }` (optional — degraded when the model proxy is unavailable, same as
core today). The plugin's `llm` backend consumes it exactly as `grammar-routes` does now.

- Rejected: plugin calls the model-proxy HTTP endpoint (`/v1/chat/completions`) — adds a loopback
  hop + re-auth, and the proxy path has the SAME gaxios blocker for Google (the in-process
  `streamSimple` + the `googleToOpenAiCompat` reroute is why grammar works). Must reuse the
  in-process seam.

## Gap 3 — config migration (`config.grammar` → `plugins.grammar`)

**Decision:** the plugin declares `configSchema` mirroring `GrammarConfig`. The plugin server entry
reads `pluginConfig`; on first load, if `plugins.grammar` is empty AND legacy `config.grammar`
exists, copy it once (read-through, no destructive migration of the core file). The settings UI
(already a `settings-section` claim) switches from `GET/PUT /api/config#grammar` to the plugin
config endpoint (`POST /api/config/plugins/grammar`).

- `GrammarCheckResult` / `GrammarSuggestion` stay in a **shared** location (both plugin server and
  plugin client import them) — they are protocol types, not core feature code. Options: keep in
  `pi-dashboard-shared` (already a plugin dep) or move into the plugin and export from its client
  entry. Keep in shared to avoid a cross-entry type import.

## Sequencing (each increment ships green)

Enablers first (reusable, no behaviour change), then the move, then delete core:

1. `composer-panel` slot + composer context (core; no claim yet — inert).
2. `ServerPluginContext.modelRuntime` (core; unused yet — inert).
3. Plugin `server` entry: register `/api/grammar/*` behind an off-by-default enable; run BOTH core
   + plugin routes only transiently during the move (plugin route under a temp prefix) to verify
   parity, then flip.
4. Plugin claims `composer-panel`; remove core `App.tsx`/`CommandInput.tsx` grammar mounts.
5. Remove core `server.ts` wiring + `grammar/**` + `grammar-routes.ts`; delete `config.grammar`
   from shared (keep result types).
6. Rename package → `grammar-plugin`; update `BUNDLED_PLUGINS` + registry gen; supersede
   `fix-grammar-settings-plugin-bundle`.

## Verification

- Parity: the moved backends keep `grammar-{llm,languagetool,service,routes}` tests (relocated into
  the plugin), incl. `googleToOpenAiCompat`.
- No core grammar references: a guard test asserts `grep -r grammar packages/server/src
  packages/client/src` finds nothing outside the slot/context generics.
- Composer latency: measure keystroke→render before/after (perf gate).
- `bundled-plugins-complete` + a new "plugin owns route" server test.
