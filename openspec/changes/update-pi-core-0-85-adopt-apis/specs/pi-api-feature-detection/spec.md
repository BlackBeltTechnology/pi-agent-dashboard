## MODIFIED Requirements

### Requirement: Runtime feature-detection governs all new-pi API adoption

The dashboard SHALL adopt every new pi runtime API behind runtime feature-detection of the concrete surface, and SHALL NOT gate behavior on the pi version string. Detection SHALL test the surface in the form that is actually load-bearing for the adoption — for a value surface, that includes its meaningful shape (e.g. `ctx.scopedModels` is detected as a **non-empty array**, because it is present-but-empty on a default unscoped session), not mere presence. A session SHALL continue to function with no crash and no behavior regression when a surface is absent or present in its no-op shape.

Because `piCompatibility.minimum` now tracks the pinned runtime in lockstep, a surface that exists at or below the pinned version is guaranteed present on every supported pi. For such a surface the dashboard SHALL consume it unconditionally and SHALL NOT retain a fallback branch, a version comparator, or a capability flag. Retaining a fallback that no supported runtime can reach SHALL be treated as dead code and removed. Feature-detection remains required only where a surface is genuinely optional at the pinned version — for example a surface whose presence depends on the provider, transport, or host rather than on the pi version.

Where a fallback is legitimately retained, it SHALL have an explicit, reachable trigger that a test can exercise.

**The removal obligation applies to version-string gates, not to runtime probes.** A fallback whose trigger is a *version comparison* against a below-floor pi SHALL be removed. A fallback reached by *probing the surface itself* MAY be retained even when the pinned runtime always satisfies the probe, because the probe costs nothing, cannot mis-answer on a future version, and is the pattern this requirement mandates. Consequently the standing `AGENTS.override.md` and `samplingParams` detections (adopted for pi 0.84.1) are retained unchanged; their scenario framing "absent on floor pi" is superseded by the lockstep floor — the absent-branch is now unreachable in the shipped configuration but stays as a probe, and SHALL NOT be cited as dead code licensed for removal by this requirement.

#### Scenario: Surface guaranteed by the pinned version is consumed unconditionally

- **GIVEN** a pi API surface that exists at the pinned runtime version
- **WHEN** the dashboard consumes it
- **THEN** the call site SHALL be unconditional
- **AND** SHALL NOT carry a version comparison or a below-floor fallback branch

#### Scenario: Optional-at-pin surface is still feature-detected

- **GIVEN** a surface whose presence at the pinned version depends on provider, transport, or host rather than on the pi version
- **WHEN** the dashboard reaches the corresponding code path
- **THEN** it SHALL detect the surface in its load-bearing shape
- **AND** SHALL execute a documented, reachable fallback when it is absent
- **AND** SHALL NOT throw, block the session, or regress prior behavior

#### Scenario: Unreachable fallback is removed, not left in place

- **GIVEN** a fallback branch whose only trigger is a pi version below `piCompatibility.minimum`
- **WHEN** the floor is raised past that version
- **THEN** the branch and its version gate SHALL be removed in the same change
- **AND** any test that existed only to cover that branch SHALL be retired with it

## ADDED Requirements

### Requirement: Tool `ctx.cwd` is honoured by dashboard-registered tools

The pinned runtime's built-in filesystem and shell tools now honour `ctx.cwd` rather than ignoring it. The dashboard's own registered tools SHALL be audited against the same defect class: any tool that resolves a filesystem path or spawns a process SHALL resolve it against `ctx.cwd` when one is supplied, and SHALL NOT silently fall back to the host process working directory. Where a dashboard tool is intentionally cwd-independent, that independence SHALL be recorded rather than left implicit.

#### Scenario: Dashboard tool resolves a relative path against ctx.cwd

- **GIVEN** a dashboard-registered tool that accepts a filesystem path
- **WHEN** it is invoked with a relative path and a `ctx.cwd` that differs from the host process cwd
- **THEN** the path SHALL resolve against `ctx.cwd`

#### Scenario: Cwd-independent tool is documented as such

- **GIVEN** a dashboard-registered tool that performs no path or process resolution
- **WHEN** the `ctx.cwd` audit is applied
- **THEN** the tool SHALL be recorded as cwd-independent
- **AND** no cwd handling SHALL be added to it

#### Scenario: No behavior depended on the previous ignore-cwd semantics

- **WHEN** the audit is performed
- **THEN** the change SHALL confirm that no dashboard code path relied on built-in tools ignoring `ctx.cwd`
- **AND** the finding SHALL be recorded

### Requirement: Abort SHALL cancel an in-progress manual compaction without stranding the compacting latch

The pinned runtime's RPC `abort` now genuinely cancels an in-progress manual compaction; previously it reported success without cancelling. The dashboard's compaction state SHALL reflect that: when a manual compaction is aborted, the server-side `compacting` indicator SHALL clear, and the session SHALL return to an idle, promptable state. The indicator SHALL NOT depend solely on a compaction-failure event to clear, because the abort path may complete without emitting one.

#### Scenario: Abort during manual compaction clears the indicator

- **GIVEN** a session with a manual compaction in progress and the `compacting` indicator set
- **WHEN** the user aborts
- **THEN** the compaction SHALL be cancelled
- **AND** the `compacting` indicator SHALL clear
- **AND** the session SHALL accept a subsequent prompt

#### Scenario: Compaction failure still clears the indicator

- **GIVEN** a session with a manual compaction in progress
- **WHEN** the compaction fails and the runtime emits its compaction-failure event
- **THEN** the `compacting` indicator SHALL clear as before

#### Scenario: Indicator does not strand after abort

- **GIVEN** an abort that cancels a compaction without emitting a compaction-failure event
- **WHEN** the abort completes
- **THEN** the `compacting` indicator SHALL NOT remain set

### Requirement: In-memory session restore SHALL be re-verified against the pinned runtime

The dashboard uses the runtime's in-memory session manager for its internal draft-agent path. The pinned runtime adds an API for restoring externally stored session entries. Because this surface is reached through runtime internals that are not exported and therefore cannot fail at build time, the change SHALL verify the in-memory session path against the pinned runtime at runtime, not by inspection alone, and SHALL record the result. Where the new restore API supersedes the dashboard's current construction, the dashboard SHALL adopt it; where it does not, the non-adoption SHALL be recorded with its reason.

#### Scenario: In-memory session path verified at runtime

- **WHEN** the dashboard's internal draft-agent path runs against the pinned runtime
- **THEN** it SHALL complete without a runtime symbol or shape error
- **AND** the verification SHALL be recorded as evidence, not assumed from a green unit-test run

#### Scenario: Restore API adoption decision is recorded

- **WHEN** the new external-entry restore API is evaluated
- **THEN** the change SHALL either adopt it or record why the existing construction is retained

### Requirement: The pinned runtime's TUI-only and non-consumed provider changes SHALL be recorded as documented no-ops

The pinned runtime ships TUI-only behavior (transcript navigation, working indicators, mouse and keybinding handling, image detection, and startup signal handling) and provider/catalog changes for providers and models the dashboard does not consume. The dashboard renders in its web client and SHALL NOT introduce TUI surfaces to consume TUI-only behavior. These SHALL be satisfied as documented no-ops, following the established precedent for prior TUI-only settings, and their absence SHALL NOT be treated as a gap.

#### Scenario: TUI-only behavior has no web-client surface

- **GIVEN** the dashboard renders in the web client and registers no pi TUI surfaces
- **WHEN** a TUI-only change is evaluated for adoption
- **THEN** the requirement SHALL be considered satisfied as a documented no-op
- **AND** no code SHALL land for it

#### Scenario: Provider change with no dashboard consumer is recorded

- **GIVEN** a provider or catalog change for a provider the dashboard does not route
- **WHEN** it is evaluated for adoption
- **THEN** it SHALL be recorded as audited with no dashboard consumer
- **AND** no task SHALL be created for it

### Requirement: Dropped and added runtime sub-dependencies SHALL be verified as unreferenced before the bump lands

The pinned runtime drops internal sub-packages and adds a replacement. The change SHALL verify by repo-wide search that no in-repo source, package manifest, or script references a dropped sub-package, and SHALL record the evidence. The dashboard SHALL import the runtime only through specifiers it already uses, and SHALL NOT take a new dependency on a runtime-internal sub-package.

#### Scenario: Dropped sub-packages are unreferenced

- **WHEN** the repo is searched for references to the dropped runtime sub-packages
- **THEN** there SHALL be zero references in source, manifests, and scripts
- **AND** the finding SHALL be recorded as evidence

#### Scenario: Import surface is unchanged

- **WHEN** the dashboard's runtime import sites are enumerated
- **THEN** they SHALL use only the specifiers already in use before the bump
- **AND** no newly published subpath SHALL be adopted by this change
