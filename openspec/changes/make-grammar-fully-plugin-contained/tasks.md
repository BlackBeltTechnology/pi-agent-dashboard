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

## 2. Enabler — model runtime in `ServerPluginContext` (core `dashboard-plugin-loader`)

- [ ] 2.1 (TDD) Loader test: a `server`-entry plugin receives `ctx.modelRuntime` with
  `getModelRegistry` + `streamSimple`; absent/degraded when the proxy is unavailable.
- [ ] 2.2 Extend `ServerPluginContext` + wire the same `getModelRegistry`/`streamSimple` seam
  `server.ts` passes to `registerGrammarRoutes` today.

## 3. Move server into the plugin

- [ ] 3.1 Add a `server` entry to the plugin (`registerPlugin(ctx)`); move `grammar/backends/**`,
  `grammar-service`, `grammar-routes` into the plugin; register `/api/grammar/*` via `ctx.fastify`.
- [ ] 3.2 Relocate `grammar-{llm,languagetool,service,routes}` tests into the plugin; keep
  `googleToOpenAiCompat` + OAuth/api_key resolution intact. Verify parity vs core route.
- [ ] 3.3 Remove `registerGrammarRoutes` call + import from `server.ts`.

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
