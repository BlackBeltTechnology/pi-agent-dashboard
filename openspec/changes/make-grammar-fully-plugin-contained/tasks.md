# Tasks

> Behaviour-preserving refactor; grammar stays opt-in (default off). Each increment must leave the
> suite green. TDD: relocate the existing grammar tests alongside the code they cover.

## 0. Preconditions

- [x] 0.1 Read `design.md` (coupling table + the 3 gaps).
- [x] 0.2 Green baseline: `pnpm run lint` + grammar suite (`grammar-*`, `config-grammar`,
  `GrammarPanel`, `useGrammarCheck`, plugin `manifest`/`GrammarSettings`).

## 1. Enabler — composer slot (core `dashboard-shell-slots`) — DONE

- [x] 1.1 (TDD) `slot-consumers.test.tsx`: a `composer-panel` claim renders and receives
  `{ draft, language }`; no claim → renders nothing. Plus `manifest-validator` accepts the slot.
- [x] 1.2 Added `composer-panel` to `SlotId` + `SLOT_DEFINITIONS` + `SlotPropsMap`; added
  `ComposerPanelSlot` consumer; `CommandInput.tsx` renders `<ComposerPanelSlot draft={text}/>`
  below the composer card (inert, no grammar reference). Typecheck + 246 runtime + 2005 client
  tests green.

## 2. Enabler — model runtime in `ServerPluginContext` (core `dashboard-plugin-loader`) — DONE

- [x] 2.1 (TDD) `server-context-model-runtime.test.ts`: an injected `modelRuntime` passes through
  the context (registry.find works); absent when the host injects none (degraded mode).
- [x] 2.2 Added `PluginModelRuntime`/`PluginModelRegistry`/`PluginStreamSimpleFn` +
  `modelRuntime?` to `ServerPluginContext` + `ServerContextDeps`; `createServerPluginContext`
  forwards it. `server.ts` wires it in the `createContext` deps, mirroring the grammar-route
  adapter (`system`→`context.systemPrompt`). Typecheck clean; seam tests green.

## 3. Move server into the plugin — DONE

- [x] 3.1 Added `server` entry (`src/server/index.ts` `registerPlugin(ctx)`); moved
  `backends/{llm,languagetool}`, `grammar-service`, `grammar-errors`, `abort` into
  `src/server/`; `mountGrammarRoutes` registers `/api/grammar/*` via `ctx.fastify` (auth-only,
  no networkGuard — plugin-route convention) using `ctx.modelRuntime`. `convertOpenAIMessages`
  replaced with an inline single-message builder (no plugin→server dep).
- [x] 3.2 Relocated `grammar-{llm,languagetool,service,routes}` tests into the plugin
  (`grammar-routes` adapted to `mountGrammarRoutes`); `googleToOpenAiCompat` + OAuth/api_key +
  google-reroute intact. Plugin suite 55/55. Runtime-verified: `[plugin:grammar-settings]
  grammar routes mounted` + a live google/gemini check returned 200.
- [x] 3.3 Removed `registerGrammarRoutes` import + call from `server.ts`; deleted core
  `server/src/grammar/**` + `routes/grammar-routes.ts`. Server suite green (only the pre-existing
  env-flaky pi-gateway-bind-host fails). Typecheck clean.

> Deferred to a DocScribe pass after increment 6: update `docs/architecture.md` grammar section
> (still describes grammar as core).

## 4. Move client into the plugin

- [ ] 4.1 Move `GrammarPanel` + `useGrammarCheck` (+ their tests) into the plugin; claim
  `composer-panel`.
- [ ] 4.2 Remove the grammar imports/mounts from `App.tsx` + `CommandInput.tsx`.

## 5. Move config into the plugin

- [ ] 5.1 Add plugin `configSchema` mirroring `GrammarConfig`; server entry reads `pluginConfig`;
  one-time read-through of legacy `config.grammar` when `plugins.grammar` is empty.
- [ ] 5.2 Settings UI writes via `POST /api/config/plugins/grammar` (was `PUT /api/config#grammar`).
- [ ] 5.3 Remove `GrammarConfig`/`DEFAULT_GRAMMAR`/parser from `shared/src/config.ts`; keep
  `GrammarCheckResult`/`GrammarSuggestion` in shared (protocol types).

## 6. Rename + finalize

- [ ] 6.1 Rename package `grammar-settings-plugin` → `grammar-plugin`; update `BUNDLED_PLUGINS`,
  `plugin-registry` generation, `bundled-plugins-complete` expectation.
- [ ] 6.2 Guard test: no grammar-specific reference remains in `packages/server/src` or
  `packages/client/src` outside the generic slot/context.
- [ ] 6.3 Supersede `fix-grammar-settings-plugin-bundle` (note in its proposal).

## 7. Validate

- [ ] 7.1 Full suite green; `pnpm run lint`; `pnpm run build`.
- [ ] 7.2 Perf: composer keystroke→render latency unchanged vs baseline (measure).
- [ ] 7.3 Manual: enable grammar in Settings, verify check + apply-correction still work on both
  `languagetool` and `google`(OpenAI-compat) backends.
