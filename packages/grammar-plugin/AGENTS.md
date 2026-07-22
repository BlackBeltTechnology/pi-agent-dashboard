# DOX — packages/grammar-plugin

First-party dashboard plugin for composer grammar/spell-check. Being made **fully
plugin-contained** (change: `make-grammar-fully-plugin-contained`): the grammar CHECK route +
backends (server entry), the composer UI (hook + panel, `composer-panel` slot claim), AND the
config (`plugins.grammar.*` via `configSchema`, migrated off core `config.grammar`) now live HERE.
Core carries ZERO grammar code. Auto-discovered under `packages/*`. Original settings-only surface:
change `add-grammar-settings-plugin`.

| File | Purpose |
|---|---|
| `package.json` | Manifest `pi-dashboard-plugin` (id `grammar`, priority 100; package `@blackbelt-technology/pi-dashboard-grammar-plugin`). `client` = `./src/index.tsx` (claims `settings-section`/`general` → `GrammarSettings` AND `composer-panel` → `GrammarComposerPanel`); `server` = `./src/server/index.ts` (owns `/api/grammar/*`); `configSchema` = `./configSchema.json` (`plugins.grammar.*`). `i18nCatalog: catalog`. `fastify` devDep for route types. See change: make-grammar-fully-plugin-contained. |
| `configSchema.json` | JSON Schema (draft-07) for `plugins.grammar.*` — validates the config written via `POST /api/config/plugins/grammar` + supplies field defaults. Mirrors `GrammarConfig`. |
| `src/grammar-config.ts` | `GrammarConfig` type + `DEFAULT_GRAMMAR` + `parseGrammarConfig` (clamp/validate) — moved from core `shared/config.ts`; the validation authority the server route + settings UI share. See change: make-grammar-fully-plugin-contained. |
| `src/index.tsx` | Client entry barrel. Re-exports `GrammarComposerPanel` + `GrammarSettings` + `catalog` (names MUST match the manifest claims for the vite-plugin named-import generator). |
| `src/GrammarComposerPanel.tsx` | `composer-panel` slot component. Receives `{draft, sessionId?, sessionStatus?, onApplyText}`, drives `useGrammarCheck` (onDraftChange=onApplyText), renders the trigger (button + document ⌘G listener, gated on `enabled`) + `GrammarPanel`. The whole composer grammar surface, owned by the plugin. See change: make-grammar-fully-plugin-contained. |
| `src/GrammarPanel.tsx` | Corrections panel (diff-highlighted original→replacement, summary, per-suggestion Accept/Dismiss, Apply-all, close). States idle→null/checking/error/done. Uses `useT()` (plugin i18n, English fallbacks). Moved from core client. |
| `src/useGrammarCheck.ts` | Composer grammar hook. One-shot `GET /api/grammar/health` then manual (`checkNow`) + debounced-auto `POST /api/grammar/check` (relative fetch, same-origin). Aborts on keystroke/session-switch; skips auto while `streaming`/below `minChars`/`/`·`!` drafts. Offset-safe `applyAll`/`accept`/`dismiss`/`dismissPanel` via `onDraftChange`. Exports `ActiveSuggestion`, `GrammarStatus`. Moved from core client (dropped `apiBase`). |
| `src/GrammarSettings.tsx` | Settings-section component (imports `GrammarConfig` from `./grammar-config.js`). For `backend: llm`, ONE model picker via the `ui:model-selector` primitive fed by `GET /api/models`; the `provider/id` label splits into `llm.{provider,model}` on save. Loads via `GET /api/config` (`data.plugins.grammar`), persists the config via `POST /api/config/plugins/grammar`, re-GETs to surface clamping. LanguageTool reachability via `GET /api/grammar/health`. |
| `src/i18n.ts` | `catalog` — unprefixed leaf keys, `hu` locale; English inline as `t(key, vars, English)`. Merged under `plugin.grammar.*`. |
| `src/server/index.ts` | **Server entry.** `registerPlugin(ctx)` mounts `/api/grammar/*` via `ctx.fastify` and runs the `llm` backend through `ctx.modelRuntime` (in-process registry + streamSimple; no model-proxy loopback). Reads config per request via `parseGrammarConfig(ctx.getPluginConfig())` (namespace `plugins.grammar`). `migrateLegacyConfig` = one-time read-through of legacy core `config.grammar` → `plugins.grammar` (idempotent) so existing users keep settings. See change: make-grammar-fully-plugin-contained. |
| `src/server/routes.ts` | `mountGrammarRoutes(fastify, deps)` — `POST /api/grammar/check` + `GET /api/grammar/health`. Auth-only (global auth hook); NO per-route `networkGuard` (plugin-route convention, matches automation-plugin). `relaxSocketTimeout` opts the check out of Fastify's 10s `connectionTimeout`. Maps `GrammarErrorCode`→HTTP. One `[grammar]` log line/call, NO draft text. `check`/`health`/`getModelRegistry`/`streamSimple` injectable. |
| `src/server/grammar-service.ts` | Backend-agnostic `checkGrammar` (gates enabled/empty, clips maxChars, dispatches by backend, maps errors→code; never throws) + `getGrammarHealth` (LT reachability probe). Moved from core `server/src/grammar`. |
| `src/server/backends/llm.ts` | LLM backend. `checkWithLlm` resolves model+creds via `ctx.modelRuntime`'s OAuth/api_key registry and runs `streamSimple`. `googleToOpenAiCompat` reroutes `google-generative-ai` models to Google's OpenAI-compat endpoint (gaxios/jiti workaround). `userPrompt` `<text>`-wraps + "proofread only". Builds the pi-ai single user message inline (no server-internal converter). See change: make-grammar-fully-plugin-contained. |
| `src/server/backends/languagetool.ts` | LanguageTool backend (offline). `checkWithLanguageTool` POSTs `<url>/v2/check`; pure `classifyIssue`/`mapMatches`/`applyCorrections`/`summarize`. Moved from core. |
| `src/server/grammar-errors.ts` | `GrammarBackendError` (carries `GrammarErrorCode`). Moved from core. |
| `src/server/abort.ts` | `withTimeoutSignal(timeoutMs, external?)` — compose timeout + abort. Moved from core. |
| `vitest.config.ts` | jsdom + `@vitejs/plugin-react`; `globalSetup` = shared `setup-home.ts` (ephemeral HOME); `setupFiles` = `src/test-support/cleanup.ts`. Runs the server backend tests + the React component/hook tests. |
| `src/test-support/cleanup.ts` | `afterEach(cleanup)` — unmount React trees between tests (Testing Library auto-cleanup needs vitest `globals:true`, unset here). |
| `src/__tests__/GrammarPanel.test.tsx` | GrammarPanel render/interaction tests (states, apply-all/accept/dismiss). Moved from core client. |
| `src/__tests__/useGrammarCheck.test.tsx` | Hook tests (health fetch, auto/manual check, abort, apply). Moved from core client (relative fetch). |
| `src/__tests__/config-grammar.test.ts` | `parseGrammarConfig` unit tests (defaults, clamping, backend fallback, llm validation, unknown keys). Moved from core `shared` (was a `loadConfig` integration test). |
| `src/__tests__/GrammarSettings.test.tsx` | Settings component tests (load/defaults/backend-conditional/save/clamp/health). Mocks `fetch`. |
| `src/__tests__/manifest.test.ts` | Manifest/barrel wiring: single settings-section claim; barrel exports; asserts the `server` entry `./src/server/index.ts` (configSchema still absent). |
| `src/__tests__/grammar-llm.test.ts` | `checkWithLlm` / `extractJsonObject` / `parseLlmResult` / `googleToOpenAiCompat` (rerouting unit + integration). Moved from core server tests. |
| `src/__tests__/grammar-languagetool.test.ts` | LanguageTool pure helpers + IO. Moved from core. |
| `src/__tests__/grammar-service.test.ts` | `checkGrammar` dispatch/gating/error-mapping. Moved from core. |
| `src/__tests__/grammar-routes.test.ts` | `mountGrammarRoutes` via a real Fastify instance (`inject`): success envelope, code→HTTP mapping, health. Moved from core (was `registerGrammarRoutes` + networkGuard). |
