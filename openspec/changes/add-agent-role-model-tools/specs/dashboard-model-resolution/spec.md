## REMOVED Requirements

### Requirement: The `model:resolve` handler SHALL succeed at cold-start by falling back to `pi.modelRegistry`

**Reason**: The fallback reads `pi.modelRegistry` — a property that does NOT exist on `ExtensionAPI` in pi-coding-agent 0.80 (it lives only on `ExtensionContext`). Session-log evidence shows this fallback is dead: in spawned/headless subagent sessions `getModelRegistry()` resolves to `undefined`, `registry.find` is never reached, and resolution fails uniformly even for models the session is actively running. The registry is not empty (it holds ~1000 models); the handle is simply undefined.

**Migration**: Replaced by "The `model:resolve` handler SHALL acquire the registry from `ctx.modelRegistry` and resolve in spawned/headless sessions" (ADDED below). The dead `pi.modelRegistry` fallback SHALL be deleted; the `(piRef as any)?.modelRegistry` cast that hid the missing property SHALL be removed.

## ADDED Requirements

### Requirement: The `model:resolve` handler SHALL acquire the registry from `ctx.modelRegistry` and resolve in spawned/headless sessions

`getModelRegistry()` SHALL return the lazily-captured `modelRegistryRef` when non-null, where `modelRegistryRef` is populated from `ctx.modelRegistry` captured across the available lifecycle points (e.g. `session_start`, `model_select`, and any earlier context the harness provides for spawned sessions). It SHALL NOT fall back to the non-existent `pi.modelRegistry` property. When no registry handle can be acquired, the handler SHALL set the existing `probe.error = "Model registry unavailable — cannot resolve \"<ref>\"."` and SHALL NOT throw.

The intent is that subagent spawning — which resolves `@role`/literal refs in the PARENT session (the harness's `resolveModelFromRef` emits `model:resolve` on a mid-session tool call, then passes the resolved `Model` into the child) — SHALL reliably fill `probe.model` for both built-in and custom-provider models. The child session never resolves for itself, so no registry handle is required in the child.

#### Scenario: Parent-side resolution fills probe.model for a known model

- **GIVEN** a running parent session whose `ctx.modelRegistry` has been captured into `modelRegistryRef`
- **AND** the registry contains `anthropic/claude-opus-4-8`
- **WHEN** the handler receives `{ ref: "anthropic/claude-opus-4-8" }`
- **THEN** the handler SHALL resolve via `modelRegistryRef.find("anthropic", "claude-opus-4-8")`
- **AND** SHALL fill `probe.model`, `probe.resolved`, and `probe.auth`
- **AND** `probe.error` SHALL remain unset

#### Scenario: Dead `pi.modelRegistry` fallback is gone

- **WHEN** the extension source is inspected
- **THEN** `getModelRegistry()` SHALL NOT reference `pi.modelRegistry` (nor a `(piRef as any).modelRegistry` cast)
- **AND** the only registry source SHALL be the `ctx.modelRegistry`-captured `modelRegistryRef`

#### Scenario: No registry handle yields the unavailable error, not a throw

- **GIVEN** `modelRegistryRef` is `null` and no `ctx.modelRegistry` has been captured
- **WHEN** a `model:resolve` probe arrives
- **THEN** the handler SHALL set `probe.error = "Model registry unavailable — cannot resolve \"<ref>\"."`
- **AND** SHALL NOT throw
- **AND** SHALL NOT fill `probe.model`

### Requirement: `model:resolve` SHALL fill `probe.model` as the primary output for `@role` refs

The primary consumer (the subagents harness) reads `probe.model` (a registry-resolved `Model` object), then `probe.error`; it does NOT read `probe.resolved`. For an `@role` ref the handler SHALL map the role to its literal via `lookupRole()`, resolve that literal through the registry, and fill `probe.model` + `probe.resolved` + `probe.auth` on success. On a registry miss the handler SHALL set `probe.error` (naming the ref) and SHALL NOT fill `probe.model`. No early-`probe.resolved` "leniency" behavior is required — a string with no `Model` does not help the primary consumer.

#### Scenario: @role fills probe.model on success

- **GIVEN** `roles.coding` is `"anthropic/claude-x"` and the registry resolves it
- **WHEN** the handler receives `{ ref: "@coding" }`
- **THEN** `probe.model` SHALL be the resolved `Model`
- **AND** `probe.resolved` SHALL equal `"<model.provider>/<model.id>"`
- **AND** `probe.auth` SHALL be filled
- **AND** `probe.error` SHALL be unset

#### Scenario: Registry miss sets probe.error, not probe.model

- **GIVEN** `roles.coding` is `"mycustom/foo-v2"` and `registry.find("mycustom","foo-v2")` returns null
- **WHEN** the handler receives `{ ref: "@coding" }`
- **THEN** `probe.error` SHALL be set naming the unresolved ref
- **AND** `probe.model` SHALL remain unset

## REMOVED Requirements

### Requirement: The legacy `flow:resolve-model` listener SHALL remain registered as a deprecated alias

**Reason**: `flow:resolve-model` is a deprecated alias whose behaviour is fully covered by `model:resolve`. It has ZERO in-repo emitters (only the handler registration exists in `provider-register.ts`) and no known external emitter, so retaining it keeps dead surface with no consumer to protect. The "keep one release" window has expired.

**Migration**: Delete the `pi.events.on("flow:resolve-model", …)` listener and its `// DEPRECATED` block from `provider-register.ts`. Any hypothetical external caller MUST migrate to `model:resolve` (which handles `@role`, `provider/model[:thinking]`, and bare ids, and fills `probe.model`). This removal is executed in THIS change, not deferred to next major.
