# Make grammar a fully self-contained dashboard plugin

## Why

Grammar is currently a **core dashboard feature with a companion settings plugin**, not a
self-contained plugin. The `grammar-settings-plugin` package is only the Settings panel; the
actual functionality is baked into core across three layers:

- **Client core** — `App.tsx` imports + mounts `GrammarPanel` + `useGrammarCheck`;
  `components/chat/CommandInput.tsx` wires the composer integration.
- **Server core** — `server.ts` unconditionally calls `registerGrammarRoutes`; the backends live
  in `packages/server/src/grammar/**`.
- **Shared core** — `config.ts` (`GrammarConfig`/`DEFAULT_GRAMMAR`) + `grammar-types.ts`.

This coupling is what produced the `bundled-plugins-complete` regression (the plugin dir shipped,
the core wiring didn't line up) — and it means grammar cannot be enabled/disabled, versioned, or
distributed as a unit. The goal: **everything grammar lives in `packages/grammar-settings-plugin`
(renamed to a grammar plugin), core carries zero grammar-specific code.**

### This is not a file move — it needs three new plugin-runtime capabilities

Investigation against the plugin runtime (`dashboard-plugin-loader`, `dashboard-shell-slots`)
found three gaps that MUST be closed first (see `design.md`):

1. **No composer slot.** The feature is a composer surface (check-as-you-type + a panel under the
   input). The slot catalog has no `composer`/`chat-input` slot, so a plugin cannot inject there.
   → Add a general `composer-panel` (+ draft-access) slot to `dashboard-shell-slots`.
2. **`ServerPluginContext` exposes no model runtime.** The `llm` backend needs
   `getModelRegistry` + `streamSimple`; the context only exposes
   `fastify/sessionManager/eventStore/directoryService/…`.
   → Extend `ServerPluginContext` with a model-runtime accessor (or route the backend through the
   in-process model-proxy).
3. **Config is core (`config.grammar`), not `plugins.grammar`.** → Migrate to the plugin
   `configSchema` + `plugins.<id>.*` namespace, with a one-time read-through of legacy
   `config.grammar`.

Each capability is **general** (reusable by any plugin), not a grammar special-case.

## What Changes

Incremental, behaviour-preserving (grammar stays opt-in, default off):

- **Increment 0 — DONE (shipped separately):** `fix-grammar-settings-plugin-bundle` added
  `grammar-settings-plugin` to `BUNDLED_PLUGINS`. Superseded here once the plugin absorbs the
  route/UI.
- **1. Composer slot** — add `composer-panel` slot + a read-only draft accessor to the shell-slots
  contract; core `CommandInput.tsx`/`App.tsx` render slot claims instead of hard-wired
  `GrammarPanel`.
- **2. Model runtime in `ServerPluginContext`** — expose `getModelRegistry()` + `streamSimple`
  (the same seam `server.ts` passes to `registerGrammarRoutes` today).
- **3. Move server** — `grammar/backends/**`, `grammar-service`, `grammar-routes` → the plugin's
  `server` entry; register `/api/grammar/*` via `ctx.fastify`. Delete the core wiring in
  `server.ts`.
- **4. Move client** — `GrammarPanel` + `useGrammarCheck` → the plugin, claiming `composer-panel`.
  Delete the core mounts in `App.tsx`/`CommandInput.tsx`.
- **5. Move config** — `GrammarConfig` + parser → the plugin `configSchema`
  (`plugins.grammar.*`); keep `GrammarCheckResult`/`GrammarSuggestion` types in the shared runtime
  (protocol types both sides need). Read-through legacy `config.grammar` once.
- **6. Rename package** `grammar-settings-plugin` → `grammar-plugin` (now full-stack), update
  `BUNDLED_PLUGINS` + `plugin-registry` generation.

Out of scope: changing grammar behaviour, the LanguageTool/LLM backends' logic, or the Google
OpenAI-compat rerouting (all move as-is).

## Risks

- The composer slot is a **new core extension point**; must not regress the composer's typing/send
  latency (a slot that reads the draft on every keystroke needs the same debounce the core hook
  had).
- Moving the `llm` backend behind the plugin server entry must preserve the OAuth/api_key
  resolution + the Google→OpenAI-compat reroute (both live in `backends/llm.ts`, move intact).
- Config migration must not lose a user's existing `config.grammar` (read-through + one-time copy).

## Discipline Skills

- `doubt-driven-review` — the composer slot + `ServerPluginContext` extension are public
  extension-point contracts; stress-test the API shape before it stands.
- `review-code` — multi-package refactor; review before commit.
- `performance-optimization` — verify the composer slot adds no keystroke-path latency vs the
  current core hook (measure before/after).
