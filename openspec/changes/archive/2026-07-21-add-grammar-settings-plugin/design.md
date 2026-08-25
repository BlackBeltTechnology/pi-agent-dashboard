# Design — Grammar settings plugin

## Goals / Non-Goals

**Goals**
- Add an in-app UI to view and change grammar behaviour, delivered as a package-only plugin.
- Leave the working core grammar feature (check logic, config block, composer panel) untouched.
- Keep `config.grammar` the single source of truth so core reads exactly as before.

**Non-Goals**
- Moving the grammar check into a plugin (blocked by the composer-slot constraint — see the
  parent change's "Why core, not a plugin").
- Relocating grammar config to a `plugins.<id>.*` namespace.

## Context / constraints (verified against the codebase)

- **Auto-discovery.** `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` scans
  `packages/*/package.json` for `pi-dashboard-plugin` manifests and generates
  `packages/client/src/generated/plugin-registry.tsx`; `server/loader.ts#discoverPlugins`
  does the server side. A new `packages/*` package with a manifest is picked up with no
  registry edit. Production filters `fixture:true`.
- **Import boundary.** Plugins may import ONLY from
  `@blackbelt-technology/dashboard-plugin-runtime` (+ `/context`, `/server`, `/vite-plugin`)
  and `@blackbelt-technology/pi-dashboard-shared`. Importing `packages/client` /
  `packages/server` fails the lint suite. So the component uses relative `fetch("/api/...")`
  (as `flows-anthropic-bridge-plugin` does: `fetch("/api/flows-anthropic-bridge/status")`),
  never `getApiBase()` from the client package.
- **Core config path.** `PUT /api/config` (`packages/server/src/routes/system-routes.ts`)
  takes a partial, runs `writeConfigPartial(partial)` then `loadConfig()`, which runs
  `parseGrammarConfig`. A `{ grammar: {...} }` partial therefore round-trips and is
  clamped/validated server-side. `GET /api/config` redacts only `auth` + `tunnel` secrets —
  `grammar` is served in clear (no secrets in it; `llm` holds provider/model *names* only).
- **Precedent.** `roles-plugin` is a client-only manifest (`client: "./src/index.tsx"`,
  no server, no build) that claims `{ slot: "settings-section", component, tab: "general" }`
  and uses a deferred **Save/Reload** persistence UX. This plugin follows the same shape.

## Decisions

### Decision 1 — Package shape mirrors `roles-plugin` (client-only, source entry)
`packages/grammar-settings-plugin/package.json`:
```jsonc
{
  "name": "@blackbelt-technology/pi-dashboard-grammar-settings-plugin",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./src/index.tsx", "default": "./src/index.tsx" } },
  "pi-dashboard-plugin": {
    "id": "grammar-settings",
    "displayName": "Grammar & Spelling",
    "i18nCatalog": "catalog",
    "priority": 100,
    "client": "./src/index.tsx",
    "claims": [
      { "slot": "settings-section", "component": "GrammarSettings", "tab": "general" }
    ]
  }
}
```
No `server`, no `configSchema` — the write path + validator + health probe already exist in
core. `private: true` (first-party, not published on its own).

### Decision 2 — Edit core `config.grammar` via `GET`/`PUT /api/config` (NOT `usePluginConfig`)
The idiomatic plugin path (`usePluginConfig` → `POST /api/config/plugins/:id`) writes
`plugins.<id>.*`. That is the wrong target here: the core grammar feature reads
`config.grammar`. So this plugin is a deliberate exception — it reads/writes the **core**
block:
- **Read:** on mount, `GET /api/config` → take `.grammar` (fall back to defaults if absent).
- **Write (Save):** `PUT /api/config` with body `{ grammar: <edited block> }`. The server
  clamps/validates via `parseGrammarConfig`; the response's reloaded config is the source of
  truth the form re-syncs to.
- **Reload:** re-`GET /api/config` and discard local edits.

This keeps a single source of truth and means the running core feature needs zero changes.

### Decision 3 — Persistence UX: local Save/Reload (recommended) vs. settings-draft-context
Two ways a `settings-section` can persist:
- **(A, recommended) Self-managed Save/Reload** inside the component (like `roles-plugin`'s
  deferred persistence). Robust, self-contained, no dependency on how the shared draft
  context scopes core vs. plugin config. Edits accumulate in local state; **Save** flushes a
  `{ grammar }` PUT; **Reload** re-reads. A dirty marker gates the buttons.
- **(B, alternative) `useSettingsDraftSource`** to join the Settings page's unified draft +
  single page-level Save. More consistent page UX, but the draft context's coverage of the
  **core** `config.grammar` (vs. plugin config) must be confirmed before relying on it.

**Recommendation: (A)** for this change (lowest coupling, matches an existing first-party
plugin). Revisit (B) as a follow-up if a unified page-level Save is desired. **Open for
review.**

### Decision 4 — Reachability indicator reuses `GET /api/grammar/health`
When `backend: "languagetool"`, the form shows a reachable/unreachable badge for the
configured `languagetool.url`, driven by the existing `GET /api/grammar/health`
(`{ languagetool: { url, reachable } }`). No new endpoint. A "Test" affordance re-probes.

### Decision 5 — Control set = the full `GrammarConfig` shape; LLM = ONE model selector
`enabled`, `autoCheck` (toggles); `backend` (select); `debounceMs`, `minChars`, `maxChars`
(numeric, with the same clamp ranges the server enforces, surfaced as input bounds);
`language` (text/select, default `auto`); `languagetool.url` (text + reachability). Server
remains the clamp authority — the UI hints ranges but never trusts client clamping.

For `backend === "llm"`, the UI presents a **single model picker**, not two free-text
`provider` / `model` fields — the pi-dashboard model selector + resolver own model choice.
The plugin obtains the picker via `useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector)`
(`ui:model-selector`, registered by the shell at startup) and feeds it the resolved catalog
from `GET /api/models` (mapped to `ModelInfo[]`; each row's `id` is `"<provider>/<id>"`).
The core `config.grammar.llm` shape stays `{ provider, model }` (untouched, out of scope):
the selector emits one `"<provider>/<id>"` label, which the plugin splits back into the two
fields on Save. One UI parameter, unchanged core contract. In tests the primitive is mocked
via `withUiPrimitiveProvider`; when unregistered the UI shows an "unavailable" note.

### Decision 6 — i18n
Every string ships in an en catalog and a `hu` catalog under `src/i18n/`, resolved via the
manifest `i18nCatalog` + the runtime `useT`. Matches the parent feature's Hungarian coverage.

## Risks / trade-offs
- **Exception to plugin config idiom.** Editing core config from a plugin is unusual; the
  parser-safety + auth-gate live in core, so risk is low, but reviewers should confirm the
  `{ grammar }` partial merge (deep vs. shallow) preserves nested `languagetool`/`llm`.
- **Two writers of `config.grammar`.** If a future core `SettingsPanel` grammar section is
  added, both would write the same block — acceptable (last-write-wins, both via `/api/config`).
- **Draft-context coverage (Decision 3B)** is unverified; hence recommending (A).

## Open questions for review
1. Persistence UX: local Save/Reload (A) or shared page draft (B)?
2. Should the section live under **General** (like roles) or its own tab (`advanced`)?
3. Package name: `pi-dashboard-grammar-settings-plugin` vs. a shorter id?
