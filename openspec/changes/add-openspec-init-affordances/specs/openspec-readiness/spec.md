# openspec-readiness Specification

> **Apply blocker (`fix-reliable-live-control-events`):** Worktree-local `resolveConfigRoot(cwd)` invalidates main-checkout skill inheritance statements and scenario E14 in this delta. Reconcile them before implementation.

## Purpose

One server-derived per-cwd OpenSpec readiness state, emitted on `OpenSpecData` and rendered by
every surface that gates on OpenSpec. Owns the `hasOpenSpecSkills` signal, the per-cwd opt-out
and fleet-level offer config, and the `POST /api/openspec/init` endpoint. See change:
add-openspec-init-affordances.

## ADDED Requirements

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

- **WHEN** a cwd contains a valid `<cwd>/openspec/` with `changes/` and `openspec list`
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
5. `BROKEN` — `openspec list` did not yield authoritative data
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

- **WHEN** a cwd has `openspec/` but `openspec list` yielded no authoritative data
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

- **WHEN** a cwd has been initialized with no proposals authored, so `openspec list` returns
  `{ "changes": [] }`, its skills are present, and its recorded signature matches the current
  one
- **THEN** the emitted state SHALL be `READY`

#### Scenario: Config change re-broadcasts only the affected cwd

- **WHEN** `/project/foo` is added to `openspec.optOutDirectories`
- **THEN** an updated payload SHALL be broadcast for `/project/foo`
- **AND** payloads for other cwds SHALL NOT be re-broadcast on account of that write

### Requirement: A never-measured project SHALL NOT be reported stale

A cwd with no recorded update signature SHALL NOT be classified `STALE` on that basis. Only a
recorded signature that differs from the current global signature SHALL trigger the
signature-based `STALE`.

This is required so that a project initialized outside the dashboard, or one whose signature
has never been recorded, is not presented as out-of-date when nothing is known about it.

#### Scenario: Never-measured project is not stale

- **WHEN** a cwd is `initialized: true` with skills present and has no recorded signature
- **THEN** the emitted state SHALL be `READY`, not `STALE`

#### Scenario: Recorded-and-differing signature is stale

- **WHEN** a cwd has a recorded signature that differs from the current global signature
- **THEN** the emitted state SHALL be `STALE` with reason `profile-stale`

### Requirement: Worktree skill presence SHALL resolve to the config root

A git worktree SHALL take its `hasOpenSpecSkills` answer from its main checkout, per the config-
root resolution above. No separate worktree exemption rule SHALL exist.

This is a deliberate trade-off: pi resolves `/skill:` from the session cwd, so a worktree whose
own `.pi/skills/` is empty can still fail to expand `openspec-explore` while readiness reports
`READY`. It is accepted because the worktree bootstrap flow is responsible for initializing
OpenSpec inside the worktree, and the alternative — every worktree permanently `STALE` — is
both worse and far more common.

#### Scenario: Worktree inherits its main checkout's skills answer

- **WHEN** a git worktree cwd has no `.pi/skills/openspec-explore/` of its own but its main
  checkout does
- **THEN** `hasOpenSpecSkills` SHALL be `true`
- **AND** the emitted state SHALL NOT be `STALE` with reason `missing-skills`

#### Scenario: Non-worktree without skills is stale

- **WHEN** a non-worktree cwd reports `initialized: true` and has no
  `.pi/skills/openspec-explore/`
- **THEN** the emitted state SHALL be `STALE` with reason `missing-skills`

### Requirement: Readiness SHALL carry a reason distinguishing remediable causes

`reason` SHALL distinguish, at minimum: `missing-changes-dir` and `cli-failed` within `BROKEN`;
`missing-skills` and `profile-stale` within `STALE`. When both `STALE` conditions hold,
`missing-skills` SHALL win, because it is the condition that breaks the session-card controls.

`BROKEN` SHALL distinguish its two causes because only `missing-changes-dir` is remediable by
re-running init; `cli-failed` is not, and offering a destructive repair there would be wrong.

#### Scenario: Missing changes dir is distinguished from CLI failure

- **WHEN** a cwd has `openspec/` but no `openspec/changes/`
- **THEN** the reason SHALL be `missing-changes-dir`
- **AND WHEN** a cwd has `openspec/changes/` but `openspec list` failed
- **THEN** the reason SHALL be `cli-failed`

#### Scenario: Missing skills wins over profile staleness

- **WHEN** a cwd is `STALE` with both missing skills and a differing signature
- **THEN** the reason SHALL be `missing-skills`

### Requirement: Config SHALL expose per-cwd opt-out and a fleet-level offer switch

`OpenSpecPollConfig` SHALL gain:

- `optOutDirectories: string[]` — cwds for which OpenSpec is suppressed entirely. Default `[]`.
  Entries SHALL be normalized with the same path normalization used for pinned directories.
- `offerInitialization: boolean` — default `true`. When `false`, the `ABSENT` state SHALL
  render no affordance on any surface, while `BROKEN`, `STALE` and `READY` SHALL be unaffected.

`offerInitialization` SHALL be distinct from `openspec.enabled`: the former suppresses only the
initialization offer, the latter disables the feature.

Both SHALL be writable over REST without the client sending the whole config, and a write
SHALL preserve every other config key.

#### Scenario: Absent keys are inert

- **WHEN** a config file contains neither key
- **THEN** `optOutDirectories` SHALL parse as empty and `offerInitialization` as `true`

#### Scenario: Path spellings normalize to one entry

- **WHEN** `/project/foo/` is added to the opt-out list and `/project/foo` is evaluated
- **THEN** that cwd SHALL be treated as opted out

#### Scenario: Fleet switch suppresses only the offer

- **WHEN** `offerInitialization === false`
- **THEN** a cwd whose state is `ABSENT` SHALL render no OpenSpec affordance
- **AND** a cwd whose state is `BROKEN`, `STALE` or `READY` SHALL render exactly as it would
  with the switch on

### Requirement: REST endpoint initializes OpenSpec in a directory

The server SHALL expose `POST /api/openspec/init` accepting a target `cwd`.

**Argv.** It SHALL spawn the OpenSpec CLI resolved through the tool-registry resolver with
exactly:

```
init <cwd> --tools pi --force
```

Note that `--tools` alone already suppresses interactive prompting and already authorizes
legacy-artifact cleanup in the supported CLI; `--force` is retained as explicit intent and
SHALL NOT be relied upon as the control for either behaviour.

- The binary SHALL be resolved via the tool-registry resolver and SHALL NOT be invoked as a
  bare `openspec` command, which may resolve to an unrelated package that initializes nothing.
- `--tools pi` SHALL always be passed; it is what writes `.pi/skills/openspec-*` and
  `.pi/prompts/opsx-*.md`.
- `--profile` SHALL NOT be passed. The CLI accepts only `core` or `custom`, while the
  dashboard's profile may be an alias it rejects. Instead the handler SHALL first heal the
  global profile config the same way the update route does, and let the CLI read it.
- Flags not registered by the supported CLI version SHALL NOT be passed; the CLI's option
  parsing is strict and an unknown option fails the invocation.
- The argv SHALL be passed as an array; the command SHALL NOT be assembled as a shell string.

**Validation.** The `cwd` SHALL be validated against the union of active session cwds and
pinned directories, **without** filtering to directories that already contain `openspec/`. The
existing known-cwd helper used by the update-status route filters to initialized projects and
SHALL NOT be reused here, because it excludes exactly the directories this endpoint targets.

**Overwrite confirmation.** When the target directory already contains an `openspec/`
directory, the endpoint SHALL refuse the request unless the caller supplies an explicit
confirmation flag. The condition is the presence of `<cwd>/openspec/` alone — deliberately
coarse, requiring no inspection of the CLI's internal legacy-artifact definition, which is not
reachable through the package's public exports and would be version-fragile.

This guard cannot be delegated to the CLI: by the time the CLI runs, cleanup is already
authorized by the presence of `--tools`.

**Concurrency.** Invocations SHALL be serialized per cwd. While an invocation is in flight for
a cwd, a second request for that same cwd SHALL be rejected immediately with `409 Conflict` and
SHALL NOT spawn a second process.

**Timeout.** A spawn SHALL be bounded at **60 seconds**. On expiry the process SHALL be killed,
the per-cwd lock released, and the request SHALL fail with the partial stderr. An unbounded
spawn would hold the lock indefinitely and, given the `409` rule above, would lock the
directory out of initialization until the server restarts.

**CLI support probe.** Before the first spawn the server SHALL probe the resolved CLI's `init`
help output to confirm it registers the `--tools` option, and SHALL cache the result for the
process lifetime. When the probe shows an unsupported CLI, the endpoint SHALL refuse with a
diagnostic naming the resolved binary rather than spawning a command whose options it does not
accept.

**Post-conditions.** On success the server SHALL record the cwd's current update signature and
force an OpenSpec poll refresh so the new readiness is broadcast without waiting for the poll
interval. The response SHALL include the CLI's stdout and stderr.

#### Scenario: Successful initialization

- **WHEN** `POST /api/openspec/init` is called for a known directory with no `openspec/`
- **THEN** the CLI SHALL be invoked with `--tools pi --force` and no `--profile`
- **AND** on success `<cwd>/openspec/changes/` and `<cwd>/.pi/skills/openspec-explore/` SHALL
  exist
- **AND** the cwd's update signature SHALL be recorded
- **AND** a payload for that cwd SHALL be broadcast without waiting for the next poll tick
- **AND** the resulting state SHALL be `READY`

#### Scenario: Expanded profile does not fail the invocation

- **WHEN** the dashboard's global profile is the expanded alias and init is requested
- **THEN** the global profile config SHALL be healed before the spawn
- **AND** no `--profile` flag SHALL be passed
- **AND** the invocation SHALL succeed

#### Scenario: Uninitialized directory is a valid target

- **WHEN** init is requested for a pinned directory that contains no `openspec/`
- **THEN** the request SHALL be accepted

#### Scenario: Unknown directory is refused

- **WHEN** init names a directory that is neither an active session cwd nor a pinned directory
- **THEN** the request SHALL be rejected and no process SHALL be spawned

#### Scenario: Concurrent invocations are rejected, not queued

- **WHEN** an init request for a cwd is in flight and a second request for the same cwd arrives
- **THEN** the second request SHALL receive `409 Conflict`
- **AND** no second process SHALL be spawned

#### Scenario: Overwrite requires confirmation

- **WHEN** init is requested for a directory that already contains `openspec/` without a
  confirmation flag
- **THEN** the request SHALL be refused and no process SHALL be spawned
- **AND WHEN** the same request carries the confirmation flag
- **THEN** the spawn SHALL proceed

#### Scenario: Hung spawn is bounded and releases the lock

- **WHEN** a spawned CLI has not exited after 60 seconds
- **THEN** the process SHALL be killed and the request SHALL fail
- **AND** a subsequent request for that cwd SHALL be accepted rather than receiving `409`

#### Scenario: Unsupported CLI is refused before spawning

- **WHEN** the resolved CLI's `init` help output does not register `--tools`
- **THEN** the endpoint SHALL refuse with a diagnostic naming the resolved binary
- **AND** no init process SHALL be spawned

#### Scenario: CLI failure is reported, not swallowed

- **WHEN** the spawned CLI exits non-zero
- **THEN** the response SHALL report failure and SHALL include the CLI's stderr
- **AND** no update signature SHALL be recorded
