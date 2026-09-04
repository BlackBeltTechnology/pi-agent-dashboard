# automation-fanout-spawn Specification

## Purpose
Lets one automation declare multiple actions — each with its own flow or skill — so a single trigger fire expands into several concurrent sessions instead of one, under an explicit bound on how many sessions a fire may start.

## Requirements

### Requirement: An automation MAY declare multiple actions

An `automation.yaml` SHALL accept either a single `action:` block or an `actions:` list. Each `actions:` entry SHALL be a complete action specification of the same shape as `action:` (`kind` plus its `prompt` / `skill` / `payload` fields), so distinct entries MAY select distinct flows or skills. `action:` and `actions:` SHALL be mutually exclusive.

#### Scenario: Two different actions declared

- **WHEN** an automation declares `actions:` with entry 1 `kind: flows.run` (flow A) and entry 2 `kind: core.skill` (skill B)
- **THEN** the automation SHALL parse as valid
- **AND** the fire SHALL produce one child per entry, each dispatched with its own action

#### Scenario: Single action stays single

- **WHEN** an automation declares only the legacy single `action:` block and no `count`
- **THEN** a fire SHALL produce exactly one child, behaving identically to the pre-fan-out behavior

#### Scenario: Both forms declared is invalid

- **WHEN** an automation declares BOTH `action:` and `actions:`
- **THEN** parsing SHALL fail with a validation error naming the conflict
- **AND** the automation SHALL be isolated as invalid without affecting other automations

#### Scenario: Empty or malformed actions list is invalid

- **WHEN** `actions:` is present but empty, or an entry has an unregistered `kind`
- **THEN** parsing SHALL fail with a validation error identifying the offending entry index

#### Scenario: An invalid actions entry cannot be persisted

- **WHEN** an automation is created or updated with an `actions:` entry whose `kind` is unregistered
- **THEN** the write SHALL be rejected with an error naming the offending entry index
- **AND** no configuration SHALL be persisted that a subsequent listing would report as invalid

### Requirement: An action entry MAY declare a spawn count

Each action entry SHALL accept an optional integer `count` (default `1`, minimum `1`) specifying how many sessions to spawn for that entry within a single fire. Each counted session SHALL be an independent child of the same fire with an identical action specification. The single `action:` block SHALL be treated as an action entry for this purpose, so `count` SHALL be honored there identically.

#### Scenario: Count on the single action block

- **WHEN** an automation declares a single `action:` block with `count: 3`
- **THEN** the fire SHALL spawn 3 children of that action

#### Scenario: Count expands one entry into N children

- **WHEN** an entry declares `count: 3`
- **THEN** the fire SHALL spawn 3 children for that entry
- **AND** each child SHALL receive the same dispatch and be tracked separately

#### Scenario: Invalid count rejected

- **WHEN** `count` is `0`, negative, or non-integer
- **THEN** parsing SHALL fail with a validation error

### Requirement: Children of one fire spawn concurrently

All children resolved from a single trigger fire SHALL be spawned concurrently, independent of the automation's `concurrency` policy. The `concurrency` policy (`skip` | `queue` | `parallel`) SHALL continue to govern OVERLAPPING FIRES of the same automation, evaluated against the parent occurrence.

#### Scenario: Children run in parallel regardless of policy

- **WHEN** an automation with `concurrency: skip` and 4 resolved children fires once
- **THEN** all 4 children SHALL be spawned without waiting for one another
- **AND** every child's spawn SHALL be initiated before any child has finalized

#### Scenario: Overlapping fire policy applies to the parent

- **WHEN** an automation with `concurrency: skip` fires again while its previous parent occurrence is still running
- **THEN** the new fire SHALL be dropped
- **AND** no additional children SHALL be spawned

### Requirement: Concurrent spawns per fire SHALL be bounded

A maximum number of children a single fire may spawn SHALL be enforced. The bound
SHALL be configurable per automation and SHALL fall back to a dashboard settings
default when the automation does not declare one; the settings default SHALL be
sourceable from deployment configuration (including Docker `.env`). The bound
SHALL be an integer of at least `1`; a `0`, negative, or non-integer bound SHALL
fail validation. No upper cap SHALL be imposed.

The bound's over-limit behavior depends on the fan-out source:

- **Static fan-out** (`count` / `actions:` expansion, no work-source): a fire
  resolving more children than the bound SHALL spawn up to the bound and record
  the excess as a bounded-truncation warning on the parent run rather than
  failing the fire. Truncation SHALL keep the FIRST children in resolution order
  — action entries in declaration order, and within an entry by ascending `count`
  index — so the surviving set is deterministic.
- **Work-source fan-out** (`on.source`): a fire SHALL lease at most the bound
  number of items and SHALL leave the remaining available items **unleased**, so
  a subsequent fire processes them. Excess work SHALL NOT be discarded and SHALL
  NOT produce a truncation warning; it is deferred, not dropped.

#### Scenario: Resolved children exceed the bound

- **WHEN** a static fan-out resolves 10 children and the effective bound is 4
- **THEN** exactly 4 children SHALL be spawned
- **AND** they SHALL be the first 4 in resolution order
- **AND** the parent run SHALL record a warning naming the bound and the number not spawned

#### Scenario: Work-source items exceed the bound are deferred

- **WHEN** a work-source fan-out has 10 available items and the effective bound is 4
- **THEN** the fire SHALL lease and spawn exactly 4 children on distinct items
- **AND** the other 6 items SHALL remain available for the next fire
- **AND** no truncation warning SHALL be recorded

#### Scenario: Invalid bound rejected

- **WHEN** `maxConcurrentSpawns` is `0`, negative, or non-integer
- **THEN** parsing SHALL fail with a validation error

#### Scenario: Per-automation bound overrides the settings default

- **WHEN** the settings default bound is 4 and the automation declares a bound of 2
- **THEN** at most 2 children SHALL be spawned per fire

#### Scenario: Bound within limit is not surfaced

- **WHEN** a fire resolves 2 children under a bound of 4
- **THEN** both SHALL spawn
- **AND** no truncation warning SHALL be recorded

### Requirement: The trigger owns distinct per-child work-item selection

For a work-source fan-out, selection SHALL be performed once by the trigger,
before spawn, not by the children. The engine SHALL resolve and lease a distinct
item per child before spawning it, and SHALL NOT pass the source collection to
children as the means of selecting work. Each spawned child SHALL process exactly
its assigned item and SHALL NOT enumerate, scan, or lease from the source itself.

#### Scenario: Child processes only its assigned item

- **WHEN** a child is spawned for a work-source fan-out
- **THEN** its action processes the single item the trigger leased for it
- **AND** the child does not read the source collection or select a different item

#### Scenario: Distinct assignment regardless of how width was declared

- **WHEN** a work-source fan-out spawns multiple children in one fire
- **THEN** every child is bound to a distinct leased item
- **AND** no two children can select the same item

### Requirement: Leasing occurs only for a fire that proceeds to spawn

For a work-source fan-out, item leasing SHALL happen AFTER the automation's
`concurrency` policy admits the fire, never before. A fire dropped by
`concurrency: skip` (its previous parent occurrence still running) or held by
`concurrency: queue` SHALL lease no items, so a non-proceeding fire cannot strand
leased-but-unspawned items until visibility-timeout expiry.

#### Scenario: A skipped overlapping fire leases nothing

- **WHEN** a `schedule.batch` automation with `concurrency: skip` fires again
  while its previous parent occurrence is still running
- **THEN** the new fire is dropped and leases no items from the source
- **AND** every available item remains available (none held by the dropped fire)

### Requirement: The leased item is injected through the per-child trigger token

The engine SHALL deliver each child's leased item by resolving that child's
`${{trigger}}` token in the action payload to the child's own item. The
substitution SHALL be per-child (each child resolves its own value), replacing
the prior per-fire single-value substitution for work-source fan-out. No new
templating syntax SHALL be introduced; the existing `${{trigger}}` token is
reused verbatim.

#### Scenario: Each child resolves its own trigger token

- **WHEN** a work-source fire spawns children bound to items `a`, `b`, and `c`
- **THEN** the child for `a` receives a payload whose `${{trigger}}` resolved to `a`
- **AND** the child for `b` resolved to `b`, and the child for `c` to `c`

#### Scenario: Templating syntax is unchanged

- **WHEN** an author writes `input: "${{trigger}}"` in a work-source automation
- **THEN** the same token used by `file`/`schedule` triggers resolves per-child
- **AND** no new placeholder syntax is required
