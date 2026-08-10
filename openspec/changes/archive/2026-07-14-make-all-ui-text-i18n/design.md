## Context

The client i18n runtime (`packages/client/src/lib/i18n.tsx`) is a lightweight custom system:

- `Language = "en" | "zh-CN"`; `en` is the **source** (empty dict → the key or an inline `fallback` string is shown), `zh-CN` holds translations.
- `t(key, vars?, fallback?)` (standalone, reads a module-level `currentLanguage` singleton) and `useI18n().t` (React hook). Interpolation via `{var}`.
- `dictionaries: Record<Language, Record<string,string>>`.

The audit (`/tmp/i18n-audit/*.md`, ~700 rows) established three zones needing different treatment. The user has decided: Zone 2 = per-plugin catalogs, Zone 3 = code-mapping, keys = structured namespaces (migrate `auto.*`), zh-CN = complete, plus a new full Hungarian locale.

## Goals / Non-Goals

**Goals:**
- 100% of user-visible strings (client + plugins + server-origin) resolve through the catalog.
- One structured key taxonomy; no `auto.*` keys remain.
- Plugins own and register their own catalogs without importing the client lib.
- Server/extension emit stable codes; client owns the code→text mapping.
- `en`, `zh-CN`, `hu` complete for every key.

**Non-Goals:**
- Runtime/remote translation fetching, pluralization libraries (ICU MessageFormat), RTL layout — keep the existing `{var}` interpolation.
- Translating log output, CLI stderr, developer-only console messages.
- Locale-aware number/date formatting beyond what exists (out of scope; `time.*` keys stay templated).

## Decisions

### D1 — Structured key taxonomy (migrate `auto.*`)

Domain-rooted namespaces (camelCase leaf):

```
common.*      session.*    worktree.*   git.*        openspec.*
gateway.*     tunnel.*     editor.*     packages.*   providers.*
models.*      folders.*    terminal.*   diff.*       doctor.*
connection.*  status.*     time.*       landing.*    settings.*
err.*         ← Zone-3 code map (err.<domain>.<code>)
plugin.<id>.* ← Zone-2, owned by each plugin
```

- Each `auto.foo` maps to its domain (`auto.attach_openspec_change → openspec.attachChange`). A one-time codemod + review produces the mapping; a temporary `LEGACY_ALIASES` map keeps old keys resolving during the migration, deleted at the end.
- `en` stays empty (source-in-code via `fallback`), OR we optionally populate `en` explicitly to decouple keys from English source strings — **decision: keep `en` empty**, English lives at the call site as the `fallback`/JSX default, consistent with today.

### D2 — Zone 2: per-plugin i18n contract

Plugins are separate packages; they must not import `packages/client/src/lib/i18n.tsx`. Instead:

```
 plugin package                runtime (dashboard-plugin-runtime)        client i18n
 ┌───────────────┐   register  ┌──────────────────────────────┐  merge  ┌───────────┐
 │ i18n: {       │────────────▶│ mergePluginCatalog(id, i18n)  │────────▶│dictionaries│
 │  "zh-CN": {…} │             │  → dictionaries[lang][         │        │ [lang]     │
 │  "hu": {…}    │             │      `plugin.${id}.${k}`]      │        └───────────┘
 │ }             │             │ expose t + language on ctx     │
 └───────────────┘             └──────────────┬───────────────┘
        plugin renders  ctx.t("plugin.flows.launch.title", vars)  ◀──────┘
```

- Plugin registration payload (shared type in `packages/shared/src/dashboard-plugin/*`) gains optional `i18n?: { catalog: Partial<Record<Language, Record<string,string>>> }`. Keys are authored **unprefixed** by the plugin; the runtime prefixes with `plugin.<id>.` on merge to guarantee no collisions.
- The plugin/slot context (`SlotContextValue`) exposes `t(key, vars?, fallback?)` and `language`. A scoped helper `t` may auto-prefix `plugin.<id>.` so plugin code writes `t("launch.title")`.
- Merge happens at registration and re-runs on language change (dictionaries are language-partitioned; merge is idempotent by key).
- **Open dependency**: `external-dashboard-plugins` may change how external (out-of-tree) plugins register — the catalog field must survive that boundary (external plugins ship catalog JSON alongside their bundle).

### D3 — Zone 3: code-mapping contract

Server/extension/shared stop relying on English reaching the UI:

- User-facing error/result/status shapes gain `code?: string` (stable, dotted or snake_case) and `vars?: Record<string, string|number>`. Existing English `message?` is retained as a **fallback only** (dev + un-mapped codes).
- Client maps `code → err.<domain>.<code>` and renders `t(key, vars, serverMessage)`. If no client key exists, the server `message` shows (graceful degradation, never a bare code).
- Add codes to emit sites lacking them (~66%). Priority: `browser-handlers/session-action-handler.ts` (10, WS toasts), `model-proxy-routes.ts` (5, HTTP errors) → then `git-operations.ts`/`provider-probe.ts` → defer `doctor-core.ts` (25, developer panel).
- The ~34% that already ship codes (`auth-gate.ts`, `spawn-preflight.ts`, `process-manager.ts`, `git-routes.ts`) only need client-side `err.*` keys.

### D4 — Hungarian locale

- `Language = "en" | "zh-CN" | "hu"`; add `{ value: "hu", label: "Magyar" }` to `LANGUAGE_OPTIONS`; `normalizeLanguage` handles `hu`, `hu-hu`, `hu-*`.
- `dictionaries.hu` added. Because `hu` is greenfield it must cover the **entire** post-migration catalog (client + all `plugin.<id>.*` + `err.*`).
- Plugin catalogs each supply their own `hu` block.

### D5 — Translation authoring

- `zh-CN`: fill every new/migrated key (existing `auto.*` zh values are reused via the alias→structured mapping).
- `hu`: author from the English source. Machine-translate seeds (as the original `auto.*` sweep did) are acceptable for a first pass; keep keys grouped for later human review. Track completeness with a catalog-parity check (every key present in `en`-source set must exist in `zh-CN` and `hu`).

### D6 — Guardrail: parity + lint

- A dev script asserts key parity across `zh-CN`/`hu`/plugin catalogs and flags any remaining hardcoded JSX/attribute strings (the audit ripgrep patterns become a lint), so regressions are caught.

## Risks / Trade-offs

- **Volume** — ~1000 keys × 3 locales ≈ 2000 values; machine-seeded `hu`/`zh-CN` risk quality issues → mitigate with grouped keys + parity check + follow-up human review.
- **Plugin-runtime coupling** — Zone 2 depends on registration/context shape that in-flight plugin-extraction changes are actively editing → coordinate/sequence; keep the catalog field additive and optional.
- **Code-map drift** — a server code with no client key must fall back to `message`, never show a raw code; covered by a spec scenario.
- **`en`-empty choice** — keeping `en` empty means the "source of truth" English lives at call sites, so a missing key silently shows the fallback; the lint (D6) compensates by forbidding un-keyed strings.
- **Migration churn** — the `auto.*`→structured rename touches ~300 keys across many files; alias map + codemod limit risk, but merge conflicts with concurrent branches are likely → land early or rebase often.
