## ADDED Requirements

### Requirement: A project-scope toggle SHALL write the pi-standard form for the resource's origin

`applyResourceToggle` SHALL classify the resolved resource by origin and write the corresponding pi-standard settings form into `<cwd>/.pi/settings.json`. The dashboard SHALL NOT introduce any notation pi does not itself interpret.

| origin | form |
|---|---|
| loose resource under the project's own base directory | force-exclude pattern relative to `<cwd>/.pi` |
| package-contributed | an `autoload: false` delta entry in `packages`, with a force-exclude relative to the package root |
| loose resource under a global base directory | a re-declaration of its containing directory plus a force-exclude by absolute path |

#### Scenario: Project loose resource keeps pi's relative-path form
- **GIVEN** a project skill at `<cwd>/.pi/skills/local-demo/SKILL.md`
- **WHEN** it is disabled at `local` scope
- **THEN** `<cwd>/.pi/settings.json#skills` gains `-skills/local-demo/SKILL.md`
- **AND** no `packages` entry is created

#### Scenario: Global loose resource is re-declared and force-excluded
- **GIVEN** a global skill at `~/.pi/agent/skills/image-to-3d-threejs/SKILL.md`
- **WHEN** it is disabled at `local` scope for `<cwd>`
- **THEN** `<cwd>/.pi/settings.json#skills` contains the directory entry `~/.pi/agent/skills`
- **AND** it contains the force-exclude `-<absolute path to that SKILL.md>`
- **AND** `~/.pi/agent/settings.json` is not written
- **AND** pi's resolver subsequently reports that skill as disabled for `<cwd>`

#### Scenario: A force-exclude without a re-declaration is never written alone
- **GIVEN** the same global skill
- **WHEN** it is disabled at `local` scope
- **THEN** the settings array SHALL NOT contain the force-exclude unless the containing directory entry is also present, because a force-exclude alone does not bring the resource into project-scope resolution

#### Scenario: Sibling global resources are unaffected
- **GIVEN** two skills in the same global directory
- **WHEN** one is disabled at `local` scope
- **THEN** pi's resolver reports the targeted skill disabled and the sibling enabled

#### Scenario: Resources in a re-declared directory are not duplicated
- **GIVEN** a global skills directory re-declared in project settings
- **WHEN** resources are resolved for that cwd
- **THEN** each skill in that directory appears exactly once in the resolved set

### Requirement: A package delta SHALL always carry `autoload: false`

When disabling a package-contributed resource at project scope, the written `packages` entry SHALL include `autoload: false`. Omitting it makes pi resolve the entry at project scope, miss the user install path, and drop the package's entire contribution.

#### Scenario: Delta entry is written with the flag
- **GIVEN** a package `npm:probe-pkg` declared only in global settings, contributing skills `alpha` and `beta`
- **WHEN** `beta` is disabled at `local` scope
- **THEN** `<cwd>/.pi/settings.json#packages` gains `{ source: "npm:probe-pkg", autoload: false, skills: ["-skills/beta/SKILL.md"] }`
- **AND** the request does not fail with "package not found in settings for scope"

#### Scenario: The package's other resources survive
- **GIVEN** the delta entry above
- **WHEN** resources are resolved for that cwd
- **THEN** `alpha` reports enabled
- **AND** `beta` reports disabled

#### Scenario: No project-scope re-install is triggered
- **GIVEN** the delta entry above for an `npm:` source installed under the user's agent directory
- **WHEN** resources are resolved for that cwd
- **THEN** no project-scope package directory is created
- **AND** the package resolves from its existing user install

#### Scenario: A second disable extends the existing delta
- **GIVEN** a project delta entry already excluding `beta` from `npm:probe-pkg`
- **WHEN** `alpha` from the same package is disabled at `local` scope
- **THEN** the same delta entry's `skills` array gains the `alpha` force-exclude
- **AND** no second entry for that source is created

### Requirement: A project-owned package entry SHALL NOT be converted into a delta

If the project's `packages` array already contains a non-delta entry for the resource's package source — a package the project genuinely declares — the exclusion SHALL be added to that existing entry using pi's ordinary filter semantics, and the entry SHALL NOT gain `autoload: false`.

#### Scenario: An existing project package entry is extended, not rewritten
- **GIVEN** `<cwd>/.pi/settings.json#packages` contains `{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }`
- **WHEN** a skill contributed by `<repo>` is disabled at `local` scope
- **THEN** that entry gains the skill force-exclude in its `skills` array
- **AND** its existing `extensions` filter is preserved unchanged
- **AND** it does not gain `autoload: false`

### Requirement: Re-enabling SHALL reverse the written form exactly

Re-enabling a resource SHALL remove what the disable added and nothing else, leaving no residue that changes how other resources resolve.

#### Scenario: Round trip restores the settings file
- **GIVEN** a project settings file in a known state
- **WHEN** a resource is disabled at `local` scope and then re-enabled
- **THEN** the settings file content is equivalent to its original state

#### Scenario: The directory re-declaration is removed with the last exclusion
- **GIVEN** a global skills directory re-declared in project settings with exactly one force-exclude
- **WHEN** that resource is re-enabled
- **THEN** the force-exclude is removed
- **AND** the directory entry is removed
- **AND** the resources in that directory report their original global scope again

#### Scenario: The directory re-declaration survives while other exclusions remain
- **GIVEN** a re-declared global directory with two force-excludes
- **WHEN** one resource is re-enabled
- **THEN** only its force-exclude is removed
- **AND** the directory entry remains
- **AND** the other resource remains disabled

#### Scenario: A user-authored directory entry is preserved
- **GIVEN** a project settings `skills` array that already contained a global directory entry before any dashboard toggle
- **WHEN** a resource in that directory is disabled and then re-enabled
- **THEN** the force-exclude is removed
- **AND** the pre-existing directory entry is left in place

#### Scenario: An emptied package delta is removed
- **GIVEN** a project delta entry whose only force-exclude is for the resource being re-enabled
- **WHEN** it is re-enabled
- **THEN** the delta entry is removed from the `packages` array entirely

### Requirement: Scope combinations pi cannot express SHALL be rejected

The server SHALL reject a toggle it cannot persist in a form pi will honour, rather than writing an inert entry and reporting success. A successful response SHALL mean the state will be reflected on the next read.

#### Scenario: Global-scope toggle of a project resource is rejected
- **GIVEN** a project skill at `<cwd>/.pi/skills/local-demo/SKILL.md`
- **WHEN** a toggle is requested with `{ scope: "global", type: "skill", filePath: "<cwd>/.pi/skills/local-demo/SKILL.md", enabled: false }`
- **THEN** the server responds `400` with an error naming the scope mismatch
- **AND** neither settings file is written

#### Scenario: The scope-containment guard actually fires
- **GIVEN** a resource whose path lies outside the base directory implied by the requested scope
- **WHEN** the toggle is applied
- **THEN** the guard SHALL evaluate the resource path against the **scope-derived** base directory, not against the resource's own `metadata.baseDir`
- **AND** the request is rejected rather than persisted

#### Scenario: No inert pattern is ever written
- **GIVEN** any accepted toggle
- **WHEN** it has been persisted
- **THEN** pi's resolver reports the requested activation state for that resource on the next resolution
