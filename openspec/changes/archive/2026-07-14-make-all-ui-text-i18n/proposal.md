## Why

The dashboard has a working client-side i18n system (`packages/client/src/lib/i18n.tsx`: `t()` + `useI18n()`, `en` source + `zh-CN` catalog), but coverage is partial. An audit (parallel sweep across client components, lib, hooks, plugins, server, extension, shared) found **~711 hardcoded user-facing strings across ~141 files** that a user can see but cannot translate:

- **Zone 1 — client** (~466): 83 component files leak strings, all 14 audited hooks have zero i18n import, and `lib/` labels/errors/time strings are raw. Whole files with zero coverage: the 6 Gateway components, `PairLanding`, `OpenSpecStepper`/`OpenSpecActivityBadge`.
- **Zone 2 — plugins** (~180): all 8 dashboard plugins (`flows`, `automation`, `goal`, `kb`, `roles`, `subagents`, `dashboard-plugin-runtime`, `flows-anthropic-bridge`) have **zero** i18n — they are separate packages that cannot import the client catalog.
- **Zone 3 — server/extension/shared** (~65): emit English strings the client renders verbatim (git `message:`, provider-probe errors, session-action WS messages, model-proxy HTTP errors). Only ~34% carry a stable machine code; the rest force the client to display raw English inside an otherwise-translated UI.

Additionally the existing catalog mixes ~300 auto-generated `auto.*` codemod keys with hand-authored structured keys, making the catalog hard to maintain. And there is currently no Hungarian locale.

## What Changes

- **Structured key convention**: adopt domain-rooted namespaces; migrate every `auto.*` and flat legacy key into a structured namespace (aliases during transition, then removed).
- **Zone 1**: wrap all remaining client component/lib/hook strings in `t()` under structured keys.
- **Zone 2 (per-plugin)**: add a per-plugin i18n contract — each plugin ships its own `zh-CN`/`hu` catalog (`plugin.<id>.*`), registers it with the dashboard plugin runtime, and receives `t` + `language` via the plugin/slot context. Wrap all plugin strings.
- **Zone 3 (code-mapping)**: server/extension/shared emit `{ code, vars }` for user-facing errors/status; client maps `code → err.<domain>.<code>` key and renders `t()`. Add codes to emit sites lacking them, high-visibility surfaces first.
- **Hungarian locale**: add `hu` as a first-class language (`Language` type, `LANGUAGE_OPTIONS`, `normalizeLanguage`) and author a **full** `hu` translation for the entire catalog (client + plugins + error map).
- **zh-CN completion**: fill every new/migrated key in `zh-CN`.

## Capabilities

### New Capabilities
- `ui-i18n-coverage`: every user-facing string across client, plugins, and server/extension-origin messages is translatable through structured keys, with `en`/`zh-CN`/`hu` catalogs; plugins register their own catalogs; server emits translation codes rather than display English.

### Modified Capabilities
<!-- No existing OpenSpec capability spec governs i18n today; this is net-new. -->

## Impact

- **Client**: `packages/client/src/lib/i18n.tsx` (language list, normalize, catalog structure, plugin-catalog merge), ~97 component/lib/hook files wrapped, `en`/`zh-CN`/`hu` dictionaries.
- **Plugins**: `packages/{flows,automation,goal,kb,roles,subagents,dashboard-plugin-runtime,flows-anthropic-bridge}-plugin` — catalog files + registration + string wrapping. Depends on the plugin runtime context (`dashboard-plugin-runtime`, `packages/shared/src/dashboard-plugin/*`).
- **Shared protocol**: `packages/shared/src` — add `code?`/`vars?` to user-facing error/result shapes; plugin i18n registration type.
- **Server/extension**: `packages/server/src` (session-action-handler, model-proxy-routes, git-operations, provider-probe, doctor-core, …), `packages/extension/src` — attach codes to emitted messages.
- **Coordination**: overlaps the in-flight `external-dashboard-plugins`, `extract-git-as-plugin`, `extract-openspec-as-plugin`, `pi-flows-adopt-extension-ui` changes (all touch plugin runtime / git message surfaces) — sequence Zone 2/3 against them.

## Discipline Skills

- `doubt-driven-review` — the Zone 2 plugin-catalog registration API and the Zone 3 `{code,vars}` protocol are cross-boundary, hard-to-reverse contracts; stress-test both before they stand.
- `scenario-design` — derive the fallback/edge scenarios (missing key, missing plugin catalog, unknown language, server code with no client mapping) that the spec must cover.
- `code-simplification` — the bulk string-wrapping is mechanical and repetitive; run a simplify pass so the catalog and helpers don't accrete duplication.
