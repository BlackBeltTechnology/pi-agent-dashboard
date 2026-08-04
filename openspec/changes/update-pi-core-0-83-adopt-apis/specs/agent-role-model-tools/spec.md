## ADDED Requirements

### Requirement: list_models SHALL be scope-aware via a non-empty ctx.scopedModels with graceful fallback

When the pi runtime exposes the session's resolved model scope as `ctx.scopedModels` (pi ≥ 0.83.0) **and that scope is non-empty**, the `list_models` tool SHALL constrain its returned catalogue to that scope by intersecting the existing `cachedModelRegistry.getAvailable()` source with `ctx.scopedModels`. Each `ctx.scopedModels` entry is `{ model, thinkingLevel? }` where `model` is a Model **object**, not a ref string; the intersection SHALL derive each entry's ref as `` `${entry.model.provider}/${entry.model.id}` `` and match it against the same ref key `list_models` already builds for its rows (`` `${m.provider ?? ""}/${m.id ?? ""}` ``, per `role-model-tools.ts`). The intersection SHALL preserve each row's `ref` (`"provider/id"`) so returned refs remain assignable via `update_roles` `set_role`, and SHALL leave the `registryReady`/`reason` discriminator semantics unchanged.

Because `ctx.scopedModels` is an array that is **empty when no scoping is configured** ("every available model is usable"), scope-awareness SHALL be feature-detected by a **non-empty length check** (`Array.isArray(ctx.scopedModels) && ctx.scopedModels.length > 0`), NOT by mere presence (`typeof … !== "undefined"`) and NOT by comparing the pi version string. When `ctx.scopedModels` is absent (older pi) **or present-but-empty** (default unscoped session), `list_models` SHALL fall back to the current unfiltered `getAvailable()` catalogue with byte-identical output to the pre-adoption behavior. The `scopedModels` capture SHALL be guarded so a missing surface never throws.

#### Scenario: Non-empty scope narrows the catalogue

- **GIVEN** the runtime exposes a non-empty `ctx.scopedModels` constraining the session to a subset of providers/models
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL contain only rows whose model is within `ctx.scopedModels`
- **AND** every returned `ref` SHALL remain assignable via `update_roles` `set_role`
- **AND** `registryReady` SHALL be computed exactly as before

#### Scenario: Present-but-empty scope falls back unchanged

- **GIVEN** the runtime exposes `ctx.scopedModels` as an empty array (no scoping configured)
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the current unfiltered `getAvailable()` catalogue
- **AND** the output SHALL be identical to the pre-adoption behavior (no models dropped)

#### Scenario: Runtime without scopedModels falls back unchanged

- **GIVEN** the runtime does not expose `ctx.scopedModels`
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the current unfiltered `getAvailable()` catalogue
- **AND** the output SHALL be identical to the pre-adoption behavior
- **AND** the tool SHALL NOT throw due to the absent surface
