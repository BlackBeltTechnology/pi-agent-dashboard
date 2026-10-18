## MODIFIED Requirements

### Requirement: Server SHALL report OpenSpec skill presence per cwd

`OpenSpecData` SHALL carry an optional `hasOpenSpecSkills?: boolean`, computed in the same stat
pass that computes `hasOpenspecDir`, as the existence of
`<configRoot>/.pi/skills/openspec-explore/`, where `configRoot` is the cwd's resolved config
root (for a git worktree, its main checkout; otherwise the cwd itself).

Resolving at the config root is required because `.pi/skills/openspec-*` is gitignored and so
never checks out into a worktree. Statting at the worktree cwd would report every worktree as
lacking skills even when its main checkout is healthy.

When the config root cannot be resolved, the stat SHALL fall back to the cwd.

The field is additive and optional: a client receiving `undefined` SHALL fall back to existing
behaviour and SHALL NOT infer absence.

#### Scenario: Project initialized with pi tooling

- **WHEN** a cwd contains `<cwd>/.pi/skills/openspec-explore/`
- **THEN** its broadcast `OpenSpecData` SHALL carry `hasOpenSpecSkills: true`

#### Scenario: Project initialized without pi tooling

- **WHEN** a cwd contains a valid `<cwd>/openspec/` with `changes/` and the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path)
  succeeds, but no `<cwd>/.pi/skills/openspec-explore/` directory
- **THEN** its broadcast `OpenSpecData` SHALL carry `initialized: true` **AND**
  `hasOpenSpecSkills: false`

### Requirement: Readiness state SHALL be derived on the server and broadcast

The server SHALL fold its available inputs — `openspec.enabled`,
`openspec.optOutDirectories`, `openspec.offerInitialization`, `hasOpenspecDir`, `initialized`,
`pending`, `hasOpenSpecSkills`, and the recorded update signature versus the current global
signature — into `OpenSpecData.readiness: { state, reason }` and SHALL emit it on every
`openspec_update` payload and on the WS on-connect snapshot.

The **current** global signature is not available to the polling service today; it is produced
by a helper scoped to the OpenSpec route registration. That helper SHALL be extracted into a
shared provider and injected into the polling service. Because the signature is global and
identical for every cwd, the provider SHALL compute it **at most once per poll tick** and cache
it for that tick; it SHALL NOT be computed per cwd. The cache SHALL be invalidated on a global
profile save and after any successful init or update.

Clients SHALL render from `readiness` and SHALL NOT re-derive it from the raw signals. When
`readiness` is absent (older server), a client SHALL fall back to its previous gate and SHALL
NOT present a disabled or stale state.

`state` SHALL be one of `GLOBAL_OFF`, `OPTED_OUT`, `PENDING`, `ABSENT`, `BROKEN`, `STALE`,
`READY`, evaluated in this precedence order, first match winning:

1. `GLOBAL_OFF` — `openspec.enabled === false`
2. `OPTED_OUT` — the cwd is listed in `openspec.optOutDirectories`
3. `PENDING` — a poll is in flight
4. `ABSENT` — `<cwd>/openspec/` does not exist
5. `BROKEN` — the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path) did not yield authoritative data
6. `STALE` — skills are missing (subject to the worktree exemption), or a recorded signature
   differs from the current global signature
7. `READY` — otherwise

Readiness SHALL be recomputed when the dashboard config changes, not only on a poll tick. The
reconfiguration path SHALL diff the readiness-affecting keys (`enabled`, `optOutDirectories`,
`offerInitialization`) against the previous config and SHALL re-broadcast only when one of them
changed, so that poll-tuning writes (interval, concurrency, jitter, worker flag) do not trigger
a readiness broadcast.

An `optOutDirectories` add or removal SHALL re-broadcast only the cwds whose membership
changed. A change to `enabled` or `offerInitialization` is global and SHALL re-broadcast every
cached cwd.

Every broadcast emitted by the reconfiguration path SHALL carry a `readiness` value. In
particular the cleared payload emitted on the `enabled true → false` edge SHALL carry
`GLOBAL_OFF` rather than omitting the field, so a current client is never forced into its
legacy-fallback gate mid-transition.

#### Scenario: Global off dominates every other signal

- **WHEN** `openspec.enabled === false` for a cwd whose data reports `initialized: true`
- **THEN** the emitted state SHALL be `GLOBAL_OFF`

#### Scenario: Opt-out dominates presence

- **WHEN** `/project/foo` is listed in `openspec.optOutDirectories` and reports
  `hasOpenspecDir: true, initialized: true`
- **THEN** the emitted state SHALL be `OPTED_OUT`

#### Scenario: Directory with no OpenSpec

- **WHEN** a cwd has no `openspec/` directory, is not opted out, and is not globally disabled
- **THEN** the emitted state SHALL be `ABSENT`

#### Scenario: Partially initialized directory

- **WHEN** a cwd has `openspec/` but the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path) yielded no authoritative data
- **THEN** the emitted state SHALL be `BROKEN`

#### Scenario: Valid project with no pi skills

- **WHEN** a non-worktree cwd reports `initialized: true, hasOpenSpecSkills: false`
- **THEN** the emitted state SHALL be `STALE` with reason `missing-skills`

#### Scenario: Opt-out of a directory that never had OpenSpec

- **WHEN** a cwd with no `openspec/` directory is listed in `openspec.optOutDirectories`
- **THEN** the emitted state SHALL be `OPTED_OUT`, not `ABSENT`
- **AND** no OpenSpec affordance SHALL render on any surface for that cwd

#### Scenario: Opt-out silences a broken project

- **WHEN** a cwd whose OpenSpec is broken is listed in `openspec.optOutDirectories`
- **THEN** the emitted state SHALL be `OPTED_OUT`
- **AND** no repair affordance SHALL render, because the user has declined OpenSpec for that
  directory

#### Scenario: Zero-proposal project is READY

- **WHEN** a cwd has been initialized with no proposals authored, so the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path) returns
  `{ "changes": [] }`, its skills are present, and its recorded signature matches the current
  one
- **THEN** the emitted state SHALL be `READY`

#### Scenario: Config change re-broadcasts only the affected cwd

- **WHEN** `/project/foo` is added to `openspec.optOutDirectories`
- **THEN** an updated payload SHALL be broadcast for `/project/foo`
- **AND** payloads for other cwds SHALL NOT be re-broadcast on account of that write

### Requirement: Readiness SHALL carry a reason distinguishing remediable causes

`reason` SHALL distinguish, at minimum: `missing-changes-dir` and `cli-failed` within `BROKEN`;
`missing-skills` and `profile-stale` within `STALE`. When both `STALE` conditions hold,
`missing-skills` SHALL win, because it is the condition that breaks the session-card controls.

`BROKEN` SHALL distinguish its two causes because only `missing-changes-dir` is remediable by
re-running init; `cli-failed` is not, and offering a destructive repair there would be wrong.

#### Scenario: Missing changes dir is distinguished from CLI failure

- **WHEN** a cwd has `openspec/` but no `openspec/changes/`
- **THEN** the reason SHALL be `missing-changes-dir`
- **AND WHEN** a cwd has `openspec/changes/` but the OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path) failed
- **THEN** the reason SHALL be `cli-failed`

#### Scenario: Missing skills wins over profile staleness

- **WHEN** a cwd is `STALE` with both missing skills and a differing signature
- **THEN** the reason SHALL be `missing-skills`
