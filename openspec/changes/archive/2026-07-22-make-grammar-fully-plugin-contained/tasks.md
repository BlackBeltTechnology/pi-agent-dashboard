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

## 4. Move client into the plugin — DONE

- [x] 4.1 Moved `GrammarPanel` + `useGrammarCheck` (+ their tests) into the plugin; added
  `GrammarComposerPanel` (composer-panel slot component: trigger + ⌘G + panel). Claimed
  `composer-panel`. Extended the slot contract with `sessionId`/`sessionStatus`/`onApplyText`
  (bounded draft-write). Added a test-support cleanup setup (auto-unmount).
- [x] 4.2 Removed grammar imports/mounts + `onGrammarCheck` from `App.tsx` + `CommandInput.tsx`
  (grammar button + ⌘G gone from the toolbar). Regenerated `plugin-registry`. Typecheck clean;
  plugin 75/75; client 1985; production build OK.

> UX change (per approved option 1): the grammar trigger moved from the composer toolbar to the
> plugin's panel below the input; functionality identical.

## 5. Move config into the plugin — DONE

- [x] 5.1 Added `configSchema.json` (`plugins.grammar.*`) + `src/grammar-config.ts` (type +
  `DEFAULT_GRAMMAR` + `parseGrammarConfig`, moved from shared). Server entry reads
  `parseGrammarConfig(ctx.getPluginConfig())`; `migrateLegacyConfig` one-time read-through of
  legacy `config.grammar` → `plugins.grammar` (idempotent). **Runtime-verified**: my live
  `config.grammar` (google/gemini) migrated + grammar check still 200.
- [x] 5.2 Settings UI loads `data.plugins.grammar`, saves via `POST /api/config/plugins/grammar`.
- [x] 5.3 Removed `GrammarConfig`/`DEFAULT_GRAMMAR`/`parseGrammarConfig`/`GrammarBackendKind` +
  the `grammar` field from `shared/src/config.ts`; kept `GrammarCheckResult`/`GrammarSuggestion`
  (+ `GrammarBackendKind`) in `shared/grammar-types.ts` (protocol types). Moved `config-grammar`
  test into the plugin (now tests `parseGrammarConfig` directly).

## 6. Rename + finalize — DONE (done BEFORE 5, so config migrates in ONE step)

- [x] 6.1 Renamed package dir `grammar-settings-plugin` → `grammar-plugin`, npm name →
  `@blackbelt-technology/pi-dashboard-grammar-plugin`, manifest id `grammar-settings` →
  `grammar`. Updated `BUNDLED_PLUGINS`, regenerated `plugin-registry`, fixed id refs (manifest
  test, i18n prefix, GrammarSettings label, test pluginId). **Also fixed a latent bug**: the
  grammar plugin was never in `packages/client/package.json` deps (3rd omission from 717929eb)
  — added it, which is why the workspace symlink now resolves. Runtime-verified: `[plugin:grammar]
  Loaded plugin` + grammar check 200.
- [x] 6.2 Guaranteed by `tsc`: core (`shared/config.ts`, `server/src`, `client/src`) imports none
  of the removed grammar symbols and references no `config.grammar` — typecheck is green with
  zero grammar code in core. (No brittle grep test added.)
- [x] 6.3 `fix-grammar-settings-plugin-bundle` proposal already notes it is superseded by this
  change (its BUNDLED_PLUGINS entry became `grammar-plugin` here).

## 7. Validate — DONE

- [x] 7.1 `pnpm run lint` clean; plugin 85/85; server suite green except 2 pre-existing env/timing
  flakes (`pi-gateway-bind-host` 0.0.0.0 bind, `rpc-keeper` 1s crash-detection); client 3835;
  production `pnpm run build` OK.
- [x] 7.2 Composer keystroke path unchanged in core (slot component owns its own debounce; core
  passes the draft without debouncing) — no added latency vs the prior in-core hook.
- [x] 7.3 Manual/runtime: grammar works end-to-end on `google`(OpenAI-compat) via the plugin route
  + composer slot; legacy config migrated; settings load/save via plugin config.

> Deferred: `docs/architecture.md` grammar section still describes grammar as core — delegate a
> DocScribe caveman-style rewrite (out of this session's scope).
