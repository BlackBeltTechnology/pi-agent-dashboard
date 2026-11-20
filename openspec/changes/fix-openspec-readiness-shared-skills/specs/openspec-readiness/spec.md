## MODIFIED Requirements

### Requirement: Server SHALL report OpenSpec skill presence per cwd

`OpenSpecData` SHALL carry an optional `hasOpenSpecSkills?: boolean`, computed in the same stat
pass that computes `hasOpenspecDir`, as the existence of
`<configRoot>/.pi/skills/openspec-explore/` (per-tool layout) **or**
`<configRoot>/.agents/skills/openspec-explore/` (shared layout written by OpenSpec 2.x),
where `configRoot` is the cwd's resolved config
root (for a git worktree, its main checkout; otherwise the cwd itself).

Resolving at the config root is required because the legacy `.pi/skills/openspec-*` is gitignored
and so never checks out into a worktree; statting at the worktree cwd would report every
worktree as lacking skills even when its main checkout is healthy. The shared `.agents/skills/`
layout is committed, so a worktree may carry its own copy; it is nevertheless resolved at the
config root too, so one fleet-wide answer applies with no per-layout worktree exemption.

When the config root cannot be resolved (`null`), the probe SHALL be refused and
`hasOpenSpecSkills` SHALL be `false`; it SHALL NOT be coerced to the cwd, and neither layout
SHALL be probed under the cwd.

The field is additive and optional: a client receiving `undefined` SHALL fall back to existing
behaviour and SHALL NOT infer absence.

#### Scenario: Project initialized with pi tooling

- **WHEN** a cwd contains `<cwd>/.pi/skills/openspec-explore/`
- **THEN** its broadcast `OpenSpecData` SHALL carry `hasOpenSpecSkills: true`

#### Scenario: Project initialized without pi tooling

- **WHEN** a cwd contains a valid `<cwd>/openspec/` with `changes/` and the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path)
  succeeds, but neither `<cwd>/.pi/skills/openspec-explore/` nor `<cwd>/.agents/skills/openspec-explore/` exists
- **THEN** its broadcast `OpenSpecData` SHALL carry `initialized: true` **AND**
  `hasOpenSpecSkills: false`

#### Scenario: Shared-layout project is not missing skills

- **WHEN** a cwd contains `<cwd>/.agents/skills/openspec-explore/` and no `<cwd>/.pi/skills/`
- **THEN** its broadcast `OpenSpecData` SHALL carry `hasOpenSpecSkills: true`
- **AND** the emitted readiness SHALL NOT be `STALE` with reason `missing-skills`

### Requirement: Worktree skill presence SHALL resolve to the config root

A git worktree SHALL take its `hasOpenSpecSkills` answer from its main checkout, per the config-
root resolution above, accepting either skill layout. No separate worktree exemption rule SHALL exist.

This is a deliberate trade-off: pi resolves `/skill:` from the session cwd, so a worktree whose
own skills (`.pi/skills/` or `.agents/skills/`) are empty can still fail to expand
`openspec-explore` while readiness reports `READY`. For the committed shared layout the skew can
also run the other way: a worktree on a branch that carries `.agents/skills/` inherits `false`
from a main checkout that lacks it. It is accepted because the worktree bootstrap flow is responsible for initializing
OpenSpec inside the worktree, and the alternative — every worktree permanently `STALE` — is
both worse and far more common.

#### Scenario: Worktree inherits its main checkout's skills answer

- **WHEN** a git worktree cwd has no `.pi/skills/openspec-explore/` of its own but its main
  checkout does
- **THEN** `hasOpenSpecSkills` SHALL be `true`
- **AND** the emitted state SHALL NOT be `STALE` with reason `missing-skills`

#### Scenario: Worktree inherits a shared-layout answer from its main checkout

- **WHEN** a git worktree cwd has no skills of its own but its main checkout has
  `.agents/skills/openspec-explore/` and no `.pi/skills/openspec-explore/`
- **THEN** `hasOpenSpecSkills` SHALL be `true`
- **AND** the emitted state SHALL NOT be `STALE` with reason `missing-skills`

#### Scenario: Non-worktree without skills is stale

- **WHEN** a non-worktree cwd reports `initialized: true` and has neither
  `.pi/skills/openspec-explore/` nor `.agents/skills/openspec-explore/`
- **THEN** the emitted state SHALL be `STALE` with reason `missing-skills`

#### Scenario: Null config root refuses both layouts

- **WHEN** the cwd's config root resolves to `null` and `<cwd>/.agents/skills/openspec-explore/` exists
- **THEN** `hasOpenSpecSkills` SHALL be `false`
