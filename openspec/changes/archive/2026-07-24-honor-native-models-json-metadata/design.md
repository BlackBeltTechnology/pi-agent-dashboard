# Design — honor native models.json metadata for discovered custom models

## Context

The dashboard has **two** model-registry paths, and #384 breaks in both:

```
                      ┌─────────────────────── EXTENSION PATH (pi session + web UI)
providers.json ──►    │ provider-register.registerEntry
models.json ─────►    │   discoverModels() → /v1/models ids
 (pi core loads       │   enrichModelMetadata(id, api, probe=find)
  natively, but…)     │     • probes ONLY built-in CANDIDATE_PROVIDERS, never
                      │       the custom name or native models.json          ── E-①
                      │   pi.registerProvider(name,{models})
                      │     • RE-registers → overwrites pi's native models    ── E-②
                      │   toModelInfo → ModelInfo.supportedThinkingLevels
                      │     • deriveSupportedThinkingLevels caps at xhigh     ── E-③
                      ▼  models_list (WS) → CommandInput → ThinkingLevelSelector
                         • THINKING_LEVELS caps at xhigh (no max)             ── ⑤

                      ┌─────────────────────── SERVER PATH (agent-facing /api/models)
providers.json ──►    │ custom-provider-discovery: /v1/models + fallback floors ── S-①
models.json ─────►    │ registry-singleton.readModels
                      │   • reads ONLY top-level array / {models:[]}          ── S-②
                      │ internal-registry.getAllModels
                      │   • concat [...discovered, ...readModels] keep-first
                      │     → discovered shadows native                        ── S-③
                      ▼ toRow → GET /api/models (drops thinkingLevelMap/compat)── S-④
```

Verified facts (this session):
- **Web UI is fed by the extension**, not the server. `CommandInput.tsx` reads
  `supportedThinkingLevels` from the `models_list` `ModelInfo`; the client has **zero**
  `/api/models` fetches. → the web-max/⑤ fix lives in the extension.
- **`GET /api/models` is agent-facing** (`models-introspection-routes.ts`), consumed by
  in-session agents (the `pi-dashboard` skill), not the React client.
- **`compat` is consumed by the pi runtime** (`streamSimple` for openai-completions reads
  `model.compat`: `thinkingFormat`, `supportsReasoningEffort`, …). It is load-bearing for
  correct request formatting on BOTH the session path and the server proxy path — NOT
  speculative. The server currently does not read `.compat` directly, but it hands the
  model to `streamSimple`, which does.
- **Dashboard pins pi-ai `0.75.5`** (canonical levels `off..xhigh`, no `max`); the
  reporter runs pi **`0.80.10`** (has `max`). The extension executes inside the *session's*
  pi (0.80.10) — the only place `max` is reachable.
- `enrichModelMetadata` (`provider-register.ts`) already inlines pi's
  `getSupportedThinkingLevels` rule as `deriveSupportedThinkingLevels`; pi-ai `.ts`
  re-exports cannot be imported at type-check time (tsconfig).

## Goals / Non-Goals

**Goals:**
- Native `providers.<p>.models[]` capability metadata (`contextWindow`, `maxTokens`,
  `reasoning`, `thinkingLevelMap`, `compat`, `input`, `cost`) wins over discovery
  fallback, on BOTH paths, for a matching `provider/id`.
- `thinkingLevelMap` reaches the web selector (extension path) AND `GET /api/models`
  (server path, agent consumers).
- `max` works end-to-end in the web UI when the **session** pi supports it; opt-in.
- Native-only entries survive `/v1/models` outage. `compat` correctly formats requests but
  is never exposed over `/api/models`. `models.json` read-only; no credentials leaked.

**Non-Goals:**
- Writing or migrating `models.json`.
- Overriding a **built-in** pi-ai model via a custom `models.json` entry under a built-in
  provider name (built-in wins; out of scope, documented).
- Adding capability fields beyond those listed.
- Server-side `max` (dashboard pi-ai 0.75.5 lacks it; the server route does not drive the
  web selector, so no server `max` detection is added).
- Live hot-reload of `models.json` edits without a refresh trigger (documented limitation).

## Decisions

### Extension path

**Terminology.** "native `models.json`" throughout means the **user-authored**
`~/.pi/agent/models.json` in pi's native nested format (`providers.<p>.models[]`). pi-ai
ships NO `models.json` — its built-in catalog is a JS `MODELS` object. The user file is the
sole nested-format source; both paths parse it via one **shared reader** (D-X2).

**D-E1 — `registerEntry` unions native ids and probes native metadata before fallback.**
The set of models registered for a provider SHALL be the **union** of (a) `/v1/models`
discovered ids and (b) ids authored under `providers.<name>.models[]` in the user file —
so a user-authored model that `/v1/models` does not return (or when `/v1/models` is down)
still reaches the session and the web UI, matching the server path (AC5, two-path
consistency). For each id in the union, resolve metadata in precedence order: (1) the
user-authored `models.json` entry for `name/id`; (2) the session registry's own
`find(name, id)` (pi's native load, if present and not yet shadowed); (3) existing
`enrichModelMetadata(id, api, probe)` api-typed fallback. The first hit supplies
`contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `compat`, `input`, `cost`.
`thinkingLevelMap`/`compat` come from the direct file read (path 1); `CatalogProbe`
(paths 2/3) supplies only the numeric/fallback fields, so its return type needs no change.
> **Assumption to verify in apply (task 1.1):** whether `pi.registerProvider` replaces or
> merges pi's natively-loaded `models.json` entries for the same provider — this fixes the
> ordering (probe native BEFORE re-registering). If pi merges (native survives), probing
> `find(name,id)` suffices; if it replaces, read native `models.json` directly. The design
> reads native `models.json` directly (path 1) so it is correct either way.

**D-E2 — carry `thinkingLevelMap` + `compat` through registration and projection.**
Extend the extension's `ModelMetadata` to include `thinkingLevelMap?` and `compat?`; pass
them into the `pi.registerProvider(name, {models})` model objects (so the session's clamp
+ request formatting are correct) and surface `thinkingLevelMap` (via
`supportedThinkingLevels`) through `toModelInfo` → `ModelInfo`.

**D-E3 — runtime-gated, opt-in `max` (exact branch specified to fail CLOSED).**
Extend the extension canonical list to `off..xhigh,max` and the web `THINKING_LEVELS`
likewise. Merely adding `"max"` to the list is a BUG: the existing filter reaches
`return true` and `undefined !== null` is true, so every reasoning model would advertise
`max` (fail-open). The derivation MUST add an explicit opt-in branch mirroring `xhigh`:
```
if (mapped === null) return false;
if (level === "xhigh") return mapped !== undefined;
if (level === "max")   return maxSupported && mapped != null;   // NEW: fail-closed
return true;
```
`max` is emitted ONLY when (a) `maxSupported` (the session runtime advertises `max`) AND
(b) `thinkingLevelMap.max` is declared non-null (opt-in). `maxSupported` is passed IN (see
D-X1) — detected from the session pi's canonical set at runtime, fail closed (false) when
undetectable. The two guards are independent: a model that does not declare `max` never
shows it regardless of runtime.

### Server path

**D-S1 — `readModels` flattens `providers.<p>.models[]`.**
Add a third accepted shape. When parsed root has `providers` (object), iterate
`providers[name].models[]` and emit one `CustomModelEntry` per model, `provider: name`
(parent key wins over any in-entry `provider`), copying `id, contextWindow, maxTokens,
reasoning, thinkingLevelMap, compat, input, cost` when present. Top-level array /
`{models:[]}` still supported and may coexist; on a `provider/id` collision between a
top-level entry and a nested entry, the nested (native) entry wins. **Per-provider**
try/catch: a malformed provider block yields `[]` for that block, never a throw; other
providers still read. A missing file and a malformed file are both `[]` (pre-existing
behavior; a `console.warn` on parse failure is added so a syntax error is not silent).

**D-S2 — `CustomModelEntry` gains `thinkingLevelMap?` and `compat?: Record<string,
unknown>`.** `compat` is opaque to the server (not interpreted) but carried on the built
registry model so `streamSimple` can format proxy requests. It is NEVER emitted by `toRow`.

**D-S3 — field-level outer join in `getAllModels`, native wins on capabilities.**
Replace entry-level keep-first (for custom models) with a per-`provider/id` merge:
- discovered entries are the routing authority (`baseUrl`, `api`, existence,
  `oauthCompatible`);
- native entries overlay **capabilities** (`contextWindow`, `maxTokens`, `reasoning`,
  `thinkingLevelMap`, `compat`, `input`, `cost`) — native wins; routing fields stay from
  discovery unless discovery lacks them (fall back to `providers.json` `baseUrl`/`api`,
  preserving the existing `cm.baseUrl || providerEntry?.baseUrl || ""` chain);
- **`oauthCompatible` is NOT a native-overridable capability** — it stays from
  discovery/built-in logic (`isOauthIncompatible`), because native `models.json` has no
  such field and defaulting it to `true` would bypass the OAuth-incompat filter;
- a native-only key (no discovered match) is added (outer join) using `providers.json`
  routing; if no `providers.json` entry exists for the name, it keeps the existing empty
  `baseUrl` fallback (orphan — surfaced but unroutable, same as today);
- built-in pi-ai models are merged first and win over any custom `provider/id`.

**D-S4 — `toRow` passes through the RAW `thinkingLevelMap`; NO server-side derivation;
excludes `compat`.** `toRow` emits the raw `thinkingLevelMap` when present so agent
consumers (the `list_models` / `pi-dashboard` skill) can interpret it themselves. The
server does NOT derive `supportedThinkingLevels` — that avoids a second derivation copy
(the web UI's derivation lives in the extension) and sidesteps the pinned-runtime `max`
question entirely. `toRow` MUST NOT emit `compat` or any credential.

### Shared

**D-X1 — exactly ONE derivation, in the extension, parameterized by `maxSupported`.**
Because D-S4 makes the server pass through the raw map (no derivation), there is exactly
one authored `deriveSupportedThinkingLevels`, in the extension. Its signature gains a
`maxSupported: boolean` parameter (evaluated at the `toModelInfo` call site from the
runtime probe); it is NOT read from a hardcoded module constant. This removes the
triple-copy risk entirely — the server never derives.

**Cross-test oracle caveat (I2):** the pinned pi-ai 0.75.5 `getSupportedThinkingLevels`
has NO `max` branch, so it CANNOT serve as the oracle for the `max` path. The derivation
test MUST use a synthetic table that includes a `max` row (`{max:"max", others:null}` with
`maxSupported:true` → `["off","max"]`; same with `maxSupported:false` → `["off"]`), not the
0.75.5 function. The non-`max` rows may be pinned against 0.75.5's function.

**D-X2 — one shared user-authored `models.json` reader.** Both D-E1 (extension) and D-S1
(server) parse `~/.pi/agent/models.json`. Extract a single pure reader (flatten
`providers.<p>.models[]` → stamped entries; accept the legacy top-level shapes; defensive
per-provider) into the shared package so the flatten/precedence logic cannot diverge
between the two paths.

## Risks / Trade-offs

- **Ordering assumption (D-E1).** Whether `registerProvider` replaces pi's native
  `models.json` load is unverified; reading native `models.json` directly in the extension
  makes the fix correct regardless, but the apply phase MUST confirm the shadowing model
  (task 1.1) before trusting `find(name,id)` alone.
- **Derivation single-sourced (was a triple-copy risk).** Resolved by D-S4 + D-X1: the
  server passes through the raw `thinkingLevelMap` (no derivation), so exactly ONE
  `deriveSupportedThinkingLevels` exists (extension), parameterized by `maxSupported`. A
  future pi level still needs one coordinated update to that single function + the web
  `THINKING_LEVELS` list — accepted, guarded by the synthetic-table test (D-X1).
- **`compat` carried but not emitted.** Load-bearing for routing; the security guard is a
  test asserting `/api/models` rows never contain `compat`/credential keys. Schema drift in
  `compat` degrades to "ignored by server, honored by runtime," not "wrong routing."
- **Two-path model-set consistency (I6).** The extension now unions user-authored ids with
  discovered ids (D-E1), matching the server union, so a `models.json`-only model reaches
  both `/api/models` and the session/UI — and survives a `/v1/models` outage (AC5) on both
  paths.
- **Outer-join surfaces native-only phantom models.** A native entry for a no-longer-served
  model still appears (mirrors pi core trusting `models.json`; required by AC #5).
- **No `models.json` hot-reload.** Editing `models.json` needs a refresh trigger (server)
  or session restart (extension, pi loads it at startup). Documented; not wired here.
- **Precedence change is behavioral.** Installs that used a top-level `models.json`
  duplicate to set metadata now see native nested win — the intended fix; changelog note.
