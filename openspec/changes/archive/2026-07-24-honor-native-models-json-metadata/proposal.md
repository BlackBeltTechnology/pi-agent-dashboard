# Honor native models.json metadata for discovered custom models

> Fixes #384. Scope: **both** model-registry paths — the dashboard **server**
> registry (agent-facing `GET /api/models` + model-proxy routing) AND the **bridge
> extension** path that feeds pi sessions and the web thinking-level selector.
> The two-path scope was chosen after doubt-review found the web UI is fed by the
> extension (WS `models_list` → `ModelInfo`), NOT the server — so a server-only fix
> could not satisfy the UI-facing acceptance criteria (3 UI, 4, break ⑤).

## Why

A native Pi install can attach rich capability metadata to a custom-provider model in
the standard nested `~/.pi/agent/models.json` format
(`providers.<provider>.models[]` with `contextWindow`, `maxTokens`, `reasoning`,
`thinkingLevelMap`, `compat`). Pi core loads this correctly for its own registry.

Two dashboard components then **shadow** that native metadata with fallback floors:

1. **Bridge extension** (`provider-register.ts:registerEntry`) discovers a provider's
   models via `/v1/models`, enriches each id with `enrichModelMetadata` — which probes
   only **built-in** provider catalogs, never the custom provider name or native
   `models.json` — then calls `pi.registerProvider(name, {models})`, re-registering the
   provider and overwriting pi's natively-loaded `models.json` entries. The web
   thinking-level selector (fed by the extension's `models_list` → `ModelInfo`) and every
   pi session therefore see fallback capabilities, no `thinkingLevelMap`, no `compat`.
2. **Server** (`registry-singleton.readModels` + `internal-registry.getAllModels`) never
   reads the native nested format at all, and its keep-first dedup shadows any duplicate.
   `GET /api/models` (consumed by in-session agents) shows wrong capabilities.

The native nested format MUST stay intact (pi core depends on it); converting it to the
dashboard's flat array is not viable, and duplicates are shadowed today. The fix teaches
both paths to **read** the native format and **merge** it with live discovery so native
capabilities win.

## What Changes

### Extension path (feeds pi sessions + web UI)

- **Probe native metadata first.** `registerEntry` SHALL resolve each discovered model's
  metadata by consulting native `models.json` (`providers.<name>.models[]`) and/or the
  session's own registry entry for `name/id` **before** falling back to
  `enrichModelMetadata`'s api-typed floors. Native `contextWindow`, `maxTokens`,
  `reasoning`, `thinkingLevelMap`, `compat`, `input`, `cost` win.
- **Carry `thinkingLevelMap` + `compat` through** the `pi.registerProvider(name,
  {models})` call (so the session's request formatting and clamp are correct) and through
  `toModelInfo` → `ModelInfo` → web selector.
- **Version-gated `max`.** Add `max` to the extension's canonical thinking-level list and
  the web `ThinkingLevelSelector`, gated so `max` surfaces only when (a) the **session's**
  pi runtime advertises `max` AND (b) the model's `thinkingLevelMap.max` is non-null
  (opt-in, mirroring `xhigh`). The extension runs inside the session's pi (e.g. 0.80.10),
  which is where `max` is actually reachable.

### Server path (agent-facing /api/models + proxy routing)

- **Read native nested format.** `registry-singleton.readModels` SHALL also parse
  `providers.<provider>.models[]`, flattening each into a `CustomModelEntry` stamped with
  its parent `provider` (parent key wins over any in-entry `provider`). Existing top-level
  array / `{models:[]}` shapes stay supported. File remains **read-only**.
- **`CustomModelEntry` gains `thinkingLevelMap` + `compat`.**
- **Field-level outer join on `provider/id`** in `getAllModels`: routing (`baseUrl`,
  `api`, existence, `oauthCompatible`) from live `/v1/models` discovery; capabilities
  (`contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `compat`, `input`,
  `cost`) from native `models.json` and **win** on overlap; native-only entries still
  surface (outer join); discovered-only entries keep fallback floors; built-in pi-ai
  models retain top precedence and are never overridden by a custom `models.json` entry
  under a built-in provider name.
- **`compat` is carried on the registry model** (so `streamSimple` proxy routing formats
  requests correctly) but **NEVER emitted by `toRow`**. `toRow` SHALL project
  `thinkingLevelMap` for agent consumers; it SHALL NOT emit `compat` or any credential.

### Both

- **No credential exposure.** `GET /api/models`, `models_list`, and logs SHALL carry
  capability/routing metadata only — never `apiKey`/auth material, never raw `compat`
  over `/api/models`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `custom-provider-model-registry`: server registry consumes native nested
  `providers.<p>.models[]` and merges it (field-level, native-wins, outer join) with live
  discovery; carries `thinkingLevelMap`/`compat`; `compat` never emitted over `/api/models`.
- `provider-auth-bridge`: the bridge SHALL probe native `models.json` metadata before
  `enrichModelMetadata` fallback and carry `thinkingLevelMap`/`compat` through
  `pi.registerProvider` and `toModelInfo`.
- `model-selector`: supported-thinking-level projection and the web selector support a
  runtime-gated, opt-in `max` level.

## Impact

- **Extension:** `packages/extension/src/provider-register.ts` (`registerEntry`,
  `enrichModelMetadata`/native probe, `ModelMetadata` type, `deriveSupportedThinkingLevels`
  + canonical list with gated `max`, `toModelInfo`), reading `~/.pi/agent/models.json`.
- **Server:** `registry-singleton.ts` (`readModels`), `internal-registry.ts`
  (`CustomModelEntry` + `getAllModels` merge), `models-introspection-routes.ts` (`toRow`
  projects `thinkingLevelMap`, excludes `compat`).
- **Client:** `ThinkingLevelSelector.tsx` (add gated `max` to `THINKING_LEVELS`),
  `ModelInfo` wire type in `packages/shared/src/types.ts` (carry `thinkingLevelMap` if the
  derivation moves client-side; otherwise unchanged — `supportedThinkingLevels` already
  exists).
- **Runtime capability detection:** extension detects the session pi's `max` support from
  its own runtime (the reachable path); server does not drive `max` (pinned pi-ai 0.75.5
  lacks it) and needs no `max` detection.
- **APIs:** `GET /api/models` gains `thinkingLevelMap` (additive); `models_list`
  `ModelInfo` reflects native levels. No breaking change.
- **Data:** `~/.pi/agent/models.json` read-only; native nested format preserved. No
  migration.

## Discipline Skills

- `security-hardening`: introspection + `models_list` touch credential-adjacent config
  (`providers.json` keys, `models.json`, opaque `compat`) — verify `/api/models`,
  `models_list`, and logs never leak `apiKey`/auth material and that `compat` is never
  serialized over `/api/models` (tasks in §5, §7).
- `review-code`: non-trivial two-path registry-merge + projection change — inline review
  before commit.
