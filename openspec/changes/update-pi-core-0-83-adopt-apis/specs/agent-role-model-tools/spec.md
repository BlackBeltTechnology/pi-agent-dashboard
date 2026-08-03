## ADDED Requirements

### Requirement: list_models SHALL be scope-aware via ctx.scopedModels with graceful fallback

When the pi runtime exposes the session's resolved model scope as `ctx.scopedModels` (pi ≥ 0.83.0), the `list_models` tool SHALL constrain its returned catalogue to that scope by intersecting the existing `cachedModelRegistry.getAvailable()` source with `ctx.scopedModels`. The intersection SHALL preserve each row's `ref` (`"provider/id"`) so returned refs remain assignable via `update_roles` `set_role`, and SHALL leave the `registryReady`/`reason` discriminator semantics unchanged.

Scope-awareness SHALL be feature-detected by the presence of `ctx.scopedModels` at runtime, NOT by comparing the pi version string. When `ctx.scopedModels` is absent (older pi, or a runtime that does not expose it), `list_models` SHALL fall back to the current unfiltered `getAvailable()` catalogue with byte-identical output to the pre-adoption behavior. The `scopedModels` capture SHALL be guarded so a missing surface never throws.

#### Scenario: Scoped runtime narrows the catalogue

- **GIVEN** the runtime exposes `ctx.scopedModels` constraining the session to a subset of providers/models
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL contain only rows whose model is within `ctx.scopedModels`
- **AND** every returned `ref` SHALL remain assignable via `update_roles` `set_role`
- **AND** `registryReady` SHALL be computed exactly as before

#### Scenario: Runtime without scopedModels falls back unchanged

- **GIVEN** the runtime does not expose `ctx.scopedModels`
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the current unfiltered `getAvailable()` catalogue
- **AND** the output SHALL be identical to the pre-adoption behavior
- **AND** the tool SHALL NOT throw due to the absent surface
