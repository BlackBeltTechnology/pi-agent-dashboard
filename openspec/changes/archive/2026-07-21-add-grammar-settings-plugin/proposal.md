# Add a dashboard plugin that surfaces grammar settings in the UI

## Why

The composer grammar/spell check feature (change: `add-composer-grammar-check`) shipped its
check logic, config block, and composer panel — but **not** the "Grammar & Spelling"
settings section the original proposal listed. Today the only way to change grammar
behaviour is to hand-edit `~/.pi/dashboard/config.json#grammar`. There is no in-app UI: the
grammar feature is **core** (the composer has no plugin slot for the Check button / panel,
so that part cannot be a plugin), and no core `SettingsPanel` section was ever built for it.

The dashboard already has a first-class mechanism for adding settings UI **from a package
only**: a plugin `settings-section` slot claim (see `roles-plugin`, `flows-anthropic-bridge-plugin`).
This change delivers the missing settings UI as a small **first-party plugin package**.

> **Scope correction (2026-07-21).** This change was scoped as "no changes to the working core
> grammar feature." That no longer holds: while building/testing the settings UI, the core
> `llm` grammar backend was found broken under OAuth (it resolved creds from an empty
> `providers.json`, always failing `backend_unconfigured`) and was fixed — rewired onto the
> OAuth/api_key-aware model runtime (pi-ai `streamSimple` + `LlmModelRegistry`) and its prompt
> broadened to improve writing, not just proofread. That core work is owned by and documented
> in `add-composer-grammar-check` (see its "Amendment — 2026-07-21" section); the CHECK-path
> "Out of Scope" line below is superseded for that item.

### Assumptions (please correct any)

- **Thin settings plugin only.** The grammar *check* stays core (server routes, composer
  integration are untouched). This plugin contributes **only** a `settings-section` that
  reads/writes the existing core `config.grammar` block. (Chosen scope — the composer
  slot constraint from `add-composer-grammar-check` still makes a full migration infeasible.)
- **Config stays in core `config.grammar`**, NOT in the plugin's `plugins.<id>.*` namespace.
  The plugin edits core config via the existing auth-gated `GET`/`PUT /api/config` path — the
  same endpoint the core `SettingsPanel` already uses. This is a deliberate exception to the
  idiomatic `usePluginConfig` (`plugins.<id>.*`) pattern, so the single source of truth for
  grammar behaviour remains `config.grammar` and the running core feature reads no differently.
- **Auto-discovered.** The plugin lives under `packages/*` with a `pi-dashboard-plugin`
  manifest; the vite plugin + server loader discover it automatically. No core registry edit.
- **Client-only plugin.** No server entry and no `configSchema` — `PUT /api/config` already
  validates/clamps the grammar block via `parseGrammarConfig`, and `GET /api/grammar/health`
  already exists for the reachability indicator.

## What Changes

- **NEW** first-party plugin package `packages/grammar-settings-plugin/`:
  - `package.json` with a `pi-dashboard-plugin` manifest — `id: "grammar-settings"`,
    `priority: 100`, `client: "./src/index.tsx"`, `i18nCatalog`, and one claim:
    `{ "slot": "settings-section", "component": "GrammarSettings", "tab": "general" }`
    (mirrors `roles-plugin`: client-only, source entry, no build step).
  - `src/index.tsx` — exports the `GrammarSettings` React component (named export the
    manifest resolves).
  - `src/GrammarSettings.tsx` — the settings form: **enable** toggle, **auto-check** toggle,
    **backend** select (`languagetool` / `llm`), **debounceMs**, **minChars**, **maxChars**,
    **language**, **LanguageTool URL** (with a reachability indicator via
    `GET /api/grammar/health`), and — for `backend: "llm"` — a **single model picker** (the
    dashboard `ui:model-selector` primitive fed by the resolved `GET /api/models` catalog),
    NOT two free-text provider/model fields. The one `provider/id` selection is split back
    into the unchanged core `llm.{provider,model}` shape on save.
    Reads current values from `GET /api/config` (grammar is not redacted); persists a
    `{ grammar: {...} }` partial via `PUT /api/config` on **Save**, with **Reload** to
    re-read from disk (Save/Reload deferred-persistence UX mirrors `roles-plugin`).
  - `src/i18n/` — an en catalog + a `hu` catalog for every user-facing string (matches the
    grammar feature's existing i18n coverage in `i18n-hu.ts`).

- **NEW** capability `grammar-settings-plugin` — the plugin's manifest claim, the settings
  controls bound to `config.grammar`, the read/persist contract over `/api/config`, the
  LanguageTool reachability indicator, and disabled-plugin behaviour (no contribution).

- **DOCUMENTATION** — a directory `AGENTS.md` for `packages/grammar-settings-plugin/` (one
  row per file), and a one-line pointer from the composer-grammar section of
  `docs/architecture.md` to the new settings plugin. (`docs/` writes delegated to DocScribe.)

## Capabilities

### New Capabilities

- `grammar-settings-plugin` — a client-only first-party plugin that claims the
  `settings-section` slot (General tab) and edits the core `config.grammar` block via the
  existing `GET`/`PUT /api/config` path, with a LanguageTool reachability indicator and
  Save/Reload persistence. No core code changes; auto-discovered.

### Modified Capabilities

- _None._ The core grammar feature (`grammar-check-service`, `composer-grammar-check`) and
  the `shared-config` grammar block are unchanged; this change only adds a consumer of them.

## Out of Scope

- **Moving grammar config into the plugin namespace** (`plugins.grammar-settings.*`) — the
  config deliberately stays in core `config.grammar` so the running core feature is untouched.
- **Any change to the grammar CHECK path** — server routes, `grammar-service`, backends, the
  composer `GrammarPanel`/`useGrammarCheck` wiring all stay as-is. **Superseded 2026-07-21**
  for the `llm` backend only: the OAuth `backend_unconfigured` fix (registry + `streamSimple`
  rewire) landed here but is owned/documented by `add-composer-grammar-check`. The
  `GrammarPanel`/`useGrammarCheck` composer wiring is still untouched.
- **A new settings tab** — the section lands under the existing **General** tab (like roles).
  A dedicated tab can be a follow-up.
- **pi terminal TUI settings** — out of scope, as in the parent grammar change.

## Discipline Skills

security-hardening (the settings form persists via the auth-gated `PUT /api/config`; must
not weaken that gate, must not surface provider credentials — only provider/model *names* —
and must not send draft text anywhere); review-code (new package + a slot contribution that
writes core config, non-trivial, tests pass before commit).
