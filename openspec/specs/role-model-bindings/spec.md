# role-model-bindings Specification

## Purpose
Lets any model setting follow a model role instead of pinning a concrete model, so switching a role or preset re-routes every dependent setting — including third-party config files that only understand concrete models — from one place.

## Requirements

### Requirement: Model refs SHALL use one value grammar

A model reference SHALL be a single string that is EITHER a direct ref `<provider>/<id>[:<level>]` OR a role ref `@<role>[:<level>]`. `<level>` SHALL be split off only when it is a canonical thinking level, so ids that legitimately contain `:` (e.g. `openrouter/vendor:free`) remain direct refs. `<role>` SHALL satisfy the shared role-name validation.

#### Scenario: Role ref with level parses
- **WHEN** the value `@coding:high` is parsed
- **THEN** it SHALL be a role ref with role `coding` and level `high`

#### Scenario: Colon inside a model id is not a level
- **WHEN** the value `openrouter/vendor:free` is parsed
- **THEN** it SHALL be a direct ref with no level

#### Scenario: Existing direct values stay valid
- **WHEN** a setting already holds `anthropic/claude-sonnet-4-5`
- **THEN** it SHALL be interpreted exactly as before this change

### Requirement: Role refs SHALL resolve through one shared resolver

Every consumer resolving a role ref SHALL use the same resolver, reading the `roles` map from `~/.pi/agent/providers.json` at resolve time (a preset load already materializes the preset into `roles`, so the resolver SHALL NOT apply `rolePresets`/`activePreset` itself). Level splitting SHALL use one shared canonical thinking-level list. Resolution SHALL return the concrete `<provider>/<id>` plus a thinking level, where a level written on the ref SHALL override the level carried by the role's own assignment. An unassigned or unknown role SHALL resolve to an explicit "unresolved" outcome carrying a reason, never to an empty or arbitrary model.

#### Scenario: Ref level overrides role level
- **GIVEN** role `fast` is assigned `anthropic/claude-haiku-4-5:low`
- **WHEN** `@fast:medium` is resolved
- **THEN** the result SHALL be model `anthropic/claude-haiku-4-5` with level `medium`

#### Scenario: Role level used when ref has none
- **GIVEN** role `fast` is assigned `anthropic/claude-haiku-4-5:low`
- **WHEN** `@fast` is resolved
- **THEN** the result SHALL be model `anthropic/claude-haiku-4-5` with level `low`

#### Scenario: Unassigned role is unresolved, not empty
- **WHEN** `@research` is resolved and `research` has no assignment
- **THEN** the outcome SHALL be unresolved with a reason naming the role

#### Scenario: Preset change is visible on the next resolve
- **WHEN** the active preset changes and a role ref is resolved afterwards
- **THEN** the result SHALL reflect the new preset's assignment without restarting the server

### Requirement: The roles plugin SHALL expose a role-binding service to server plugins

When the roles plugin is installed, it SHALL provide an in-process server service through the cross-plugin service seam that lets other plugins (a) resolve role refs, (b) list effective role names with their current resolution, and (c) register a projector. When the roles plugin is not installed, the service SHALL be absent and consumers SHALL degrade without error. Consumers SHALL be able to obtain the service regardless of plugin load order (no hard `dependsOn` on the roles plugin required).

#### Scenario: Consumer works without roles plugin
- **WHEN** the roles plugin is not installed and a plugin looks up the role-binding service
- **THEN** the lookup SHALL yield "absent" without throwing, and that plugin's direct-model behavior SHALL be unchanged

#### Scenario: Load order does not matter
- **WHEN** a consumer plugin is registered before the roles plugin
- **THEN** it SHALL still be able to register its projector once all plugins are registered

### Requirement: Projectors SHALL write concrete models for role-bound fields

A projector SHALL declare an owner id and a field validator (which field keys it accepts, allowing variable-length lists such as fallback chains), and supply a read callback (current concrete value of a field) and a write callback (persist a concrete `{provider, id, level?}` to a field). Binding a field to a role SHALL be accepted only for a field key the owning projector's validator accepts. Recording bindings after a plugin's own save SHALL mark them `ok` with the just-written value as last projected, and SHALL NOT be interleaved with a projection pass for the same owner. The service SHALL NOT write any target file itself; all target writes SHALL go through the owning projector's write callback.

#### Scenario: Undeclared field is rejected
- **WHEN** a binding is requested for owner `blackhole` field `notAField` that the blackhole projector's validator rejects
- **THEN** the request SHALL be rejected and nothing SHALL be written

#### Scenario: Binding on save writes the concrete value
- **WHEN** a blackhole save binds `observerModel` to `@fast` and `@fast` resolves to `anthropic/claude-haiku-4-5:low`
- **THEN** the target SHALL contain provider `anthropic`, id `claude-haiku-4-5`, level `low` after the save
- **AND** the binding SHALL be recorded with status `ok`

#### Scenario: Save racing a projection pass does not detach
- **WHEN** a projection pass for owner `blackhole` is triggered while a blackhole save is in flight
- **THEN** the pass SHALL run after the save's bindings are recorded AND the just-saved bindings SHALL NOT be marked `detached`

### Requirement: Role and preset changes SHALL re-project every binding

The service SHALL re-resolve all bindings whenever the effective role configuration in `providers.json` changes, regardless of who changed it (Roles settings UI, the agent `update_roles` tool, or a manual edit), and SHALL invoke a projector write only for bindings whose resolved value differs from the last projected value. On server start the service SHALL re-project all bindings once, so changes made while the server was down are applied. Changes SHALL be coalesced so a burst of writes to `providers.json` causes one re-projection pass. Every affected target SHALL reflect a change within 5 s of the `providers.json` write completing, with up to 1000 bindings registered. Change detection SHALL NOT depend on the platform reporting the `providers.json` filename (atomic tmp-file renames may be reported under another name or none).

#### Scenario: Preset load re-routes a third-party config
- **GIVEN** blackhole `observerModel` is bound to `@fast`
- **WHEN** the user loads a preset that assigns `@fast` to `openai/gpt-5-mini`
- **THEN** `pi-blackhole-config.json` SHALL receive `observerModel` = `{provider:"openai", id:"gpt-5-mini"}`

#### Scenario: Agent tool change is picked up
- **WHEN** an agent changes a role assignment through the `update_roles` tool
- **THEN** every binding following that role SHALL be re-projected

#### Scenario: Change while server down applies on boot
- **WHEN** a role assignment changes while the dashboard server is stopped and the server then starts
- **THEN** every affected binding SHALL be re-projected during startup

#### Scenario: Deadline holds at scale
- **GIVEN** 1000 bindings across registered projectors, all following `@fast`
- **WHEN** `@fast` is reassigned
- **THEN** every target SHALL hold the new concrete model within 5 s of the `providers.json` write

#### Scenario: Atomic rename is detected
- **WHEN** a writer replaces `providers.json` via a temp file + rename and the platform reports the event under the temp filename
- **THEN** the change SHALL still trigger a re-projection pass

#### Scenario: Unchanged resolution causes no write
- **WHEN** `providers.json` changes but a binding's resolved value is identical to its last projected value
- **THEN** that binding's projector write SHALL NOT be invoked

### Requirement: Bindings SHALL carry a visible status

Each binding SHALL have status `ok`, `detached`, or `dangling`. `dangling` SHALL apply when the role is unresolved; the target SHALL keep its last projected value and SHALL NOT be blanked. `detached` SHALL apply when the projector's read returns a value different from the last projected value (the target was edited outside the binding); a detached binding SHALL NOT overwrite the target until the user re-binds or re-attaches it. Status SHALL be readable by the owning plugin's UI.

#### Scenario: Unassigned role keeps last value
- **GIVEN** `observerModel` is bound to `@fast` and was projected as `anthropic/claude-haiku-4-5`
- **WHEN** `@fast` becomes unassigned
- **THEN** the binding status SHALL be `dangling` AND the target SHALL still hold `anthropic/claude-haiku-4-5`

#### Scenario: External edit detaches the binding
- **WHEN** a user edits `observerModel` directly in `pi-blackhole-config.json` and a later role change occurs
- **THEN** the binding status SHALL be `detached` AND the projector write SHALL NOT be invoked

#### Scenario: Re-attach resumes projection
- **WHEN** the user re-attaches a detached binding
- **THEN** the current resolution SHALL be projected and the status SHALL return to `ok`

### Requirement: Binding state SHALL persist in a dashboard-owned store

Bindings SHALL persist across restarts in a dashboard-owned file (not `providers.json`, not any third-party target). The store SHALL be written atomically. A missing or unparseable store SHALL be treated as "no bindings" and SHALL NOT alter any target file. Removing a binding SHALL leave the target's last projected concrete value in place.

#### Scenario: Corrupt store fails safe
- **WHEN** the binding store contains invalid JSON at startup
- **THEN** the service SHALL start with no bindings, log the condition, and SHALL NOT write any target

#### Scenario: Unbinding keeps the concrete value
- **WHEN** a field bound to `@fast` (projected as `anthropic/claude-haiku-4-5`) is unbound
- **THEN** the target SHALL still hold `anthropic/claude-haiku-4-5`

### Requirement: Projection outcomes SHALL be observable

Each re-projection pass SHALL log one structured line summarizing trigger (boot / change), bindings evaluated, written, unchanged, dangling, detached, and failed. A projector write failure SHALL be logged with owner and field, SHALL NOT abort the remaining bindings, and SHALL be retried on the next pass. Bindings whose owner has no registered projector (owner plugin disabled or uninstalled) SHALL be skipped and counted as `skipped` — not as failures — and SHALL be kept in the store so they resume when the owner returns (subject to the `detached` check).

#### Scenario: Bindings of an absent owner are kept and skipped
- **GIVEN** bindings exist for owner `blackhole` and the blackhole plugin is not loaded
- **WHEN** a projection pass runs
- **THEN** those bindings SHALL be counted as `skipped`, SHALL NOT be logged as failures, and SHALL remain in the store

#### Scenario: One failing projector does not block others
- **WHEN** the blackhole projector's write throws during a pass that also has another owner's binding to update
- **THEN** the other owner's binding SHALL still be written AND the failure SHALL be logged with owner `blackhole` and the field key

### Requirement: Model roles settings SHALL show what follows each role

The Model roles settings page SHALL list, per role, every projector binding (owner + field + status) and every known resolve-at-use reference that follows that role, so the impact of a role or preset change is visible before it is made. Resolve-at-use automation references SHALL cover every automation the automation plugin currently knows (global and every loaded folder).

#### Scenario: Used-by list for a role
- **GIVEN** blackhole `observerModel` and the grammar model both follow `@fast`
- **WHEN** the user opens the Model roles page
- **THEN** `@fast` SHALL show both usages, with the blackhole binding's status
