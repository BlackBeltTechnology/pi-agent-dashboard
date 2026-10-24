# Spec Delta

## MODIFIED Requirements

### Requirement: Skills, prompts, and themes SHALL be sourced from pi's resolver

The scanner SHALL derive skills, prompts, and themes from the `ResolvedPaths` returned by `resolveActivation()` — pi's own `DefaultPackageManager.resolve()` output — rather than from an independent filesystem walk. Each `ResolvedResource` provides `path`, `enabled`, and `metadata` carrying `source`, `scope`, and `origin`.

While the resolver is available the scanner SHALL NOT apply its own discovery rules to these three resource types. One exception applies. For an installed package that is an imported Claude plugin, the scanner SHALL also report the skills recorded in that plugin's import record. Each is attributed to that package, marked as managed by the Claude plugin, and reported enabled exactly when that install is active. That is the only skill discovery outside the resolver. This constraint does not extend to `extensions` or `agents`, which have no resolver equivalent for `agents` and are out of scope for `extensions`.

The scanner's package resolution, `npm root -g` caching, and package metadata reading remain in use for building the package rows themselves; only skill, prompt, and theme *discovery* moves to the resolver.

#### Scenario: Resolved skills populate the scan result

- **WHEN** `resolveActivation()` returns skills for a working directory
- **THEN** the scan result SHALL contain one skill per resolved entry that passes the load gate
- **AND** each SHALL carry the resolved `path` as its `filePath`

#### Scenario: Scope and origin become per-resource attributes

- **GIVEN** resolved entries with `metadata.scope` of `project` and `user`, and `metadata.origin` of `top-level` and `package`
- **WHEN** the scan result is assembled
- **THEN** `project` entries SHALL carry a `local` scope attribute
- **AND** `user` entries SHALL carry a `global` scope attribute
- **AND** `package`-origin entries SHALL carry package provenance derived from `metadata.source`

#### Scenario: Temporary scope is treated as local

- **GIVEN** a resolved entry with `metadata.scope` of `temporary`
- **WHEN** the scan result is assembled
- **THEN** it SHALL carry the `local` scope attribute

#### Scenario: Unmatched package source is still reported

- **GIVEN** a `package`-origin entry whose `metadata.source` matches no known package row
- **WHEN** the scan result is assembled
- **THEN** the resource SHALL still be reported
- **AND** it SHALL be labelled with the raw `metadata.source` value
- **AND** it SHALL NOT be dropped

#### Scenario: Manifest-excluded package resources are absent

- **GIVEN** a package whose manifest patterns exclude one of its own resources
- **AND** that resource is therefore absent from `ResolvedPaths`
- **WHEN** the scan result is assembled
- **THEN** the resource SHALL NOT be reported
- **AND** the scan SHALL NOT synthesise a disabled entry for it

#### Scenario: Activation state comes from the resolver

- **GIVEN** a resolved entry with `enabled: false`
- **WHEN** the scan result is assembled
- **THEN** that resource SHALL be reported as disabled
- **AND** its state SHALL NOT be recomputed by a separate derivation

#### Scenario: Reference and documentation files are never reported

- **GIVEN** a skill directory containing `SKILL.md` alongside `UPSTREAM.md`, `dox-doctrine.md`, or a `references/` subtree
- **WHEN** the scan result is assembled from the resolver
- **THEN** only the `SKILL.md` entry SHALL be reported

#### Scenario: Ignored and out-of-tree files are never reported

- **GIVEN** `SKILL.md` files beneath `.worktrees/` and inside a built Electron bundle
- **WHEN** the scan result is assembled from the resolver
- **THEN** none of them SHALL be reported

#### Scenario: Themes are reported

- **WHEN** `resolveActivation()` returns theme entries
- **THEN** they SHALL appear in the scan result as theme resources

#### Scenario: Imported Claude plugin skills are reported
- **GIVEN** an imported Claude plugin installed globally whose import record lists skill `pdf-tools`
- **WHEN** the scan result is assembled
- **THEN** `pdf-tools` SHALL be reported as a skill with global scope, package provenance naming that plugin's package, and a managed-by-Claude-plugin marker
