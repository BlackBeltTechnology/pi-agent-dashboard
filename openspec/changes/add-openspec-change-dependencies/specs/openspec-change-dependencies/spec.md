## Purpose

Change-to-change dependencies for OpenSpec changes: a committed per-change `dependencies.yaml`, deterministic inference from proposals and spec deltas, a validated dependency graph with execution waves, and REST access for the board and ship-it.

## ADDED Requirements

### Requirement: Per-change dependencies file

A change MAY carry `openspec/changes/<name>/dependencies.yaml` with optional keys `blocked_by` (list of `{ change, reason? }` or bare names), `not_blocked_by` (list of names) and `related` (list of names). The file SHALL be parsed with a safe YAML parser, rejecting aliases and files larger than 64 KiB. `blocks` SHALL NOT be stored; it SHALL always be computed as the inverse of `blocked_by`. Empty lists SHALL be a valid explicit "no dependencies" declaration. The file SHALL be honoured for every schema.

#### Scenario: Shorthand and long form are equivalent

- **WHEN** one change declares `blocked_by: [add-x]` and another `blocked_by: [{ change: add-x, reason: "api" }]`
- **THEN** both SHALL produce an open `declared` edge to `add-x` (the second with its reason)

#### Scenario: Oversized or aliased file is invalid

- **WHEN** `dependencies.yaml` exceeds 64 KiB or contains a YAML alias
- **THEN** the change SHALL carry an `invalid-file` error issue and no declared edges

### Requirement: Workflow schema patch v2 adds the dependencies artifact

The `pi-spec-driven` generator SHALL set CURRENT_PATCH to 2. The v2 patch SHALL insert an artifact `{ id: dependencies, generates: dependencies.yaml, template: dependencies.yaml, requires: [proposal, specs] }` before `tasks`, with an instruction to inspect other active changes and declare `blocked_by` / `not_blocked_by` / `related`, writing empty lists when there are none. It SHALL set `tasks.requires` to `[specs, design, dependencies]`. Schemas stamped with patch 1 SHALL report `schema-stale`.

#### Scenario: New change requires the declaration

- **GIVEN** a project on `pi-spec-driven` patch 2
- **WHEN** a new change has proposal, specs and design but no `dependencies.yaml`
- **THEN** `openspec status` SHALL report `dependencies: ready` and `tasks: blocked`

#### Scenario: Patch 1 schema is stale

- **GIVEN** a generated schema stamped with patch 1
- **WHEN** readiness is evaluated by a dashboard whose CURRENT_PATCH is 2
- **THEN** readiness SHALL report `STALE` with reason `schema-stale`

### Requirement: Dependency inference is deterministic and never written to disk

The server SHALL compute inferred edges on every poll that rebuilds a directory's data, in the poll worker, from:
- **L1:** proposal wording. Only backticked tokens that resolve to a known change name count. Direction comes from keywords: blocked-by keywords (`depends on`, `builds on`, `requires`, `blocked by`, `on top of`, `after`), blocks keywords (`blocks`, `unblocks`, `follow-up`, `consumers`, `enables`), and anything else (including `sibling`, `related`, `tracked under`, `out of scope`, `distinct`, `supersedes`) becomes `related`.
- **L2:** capability birth. Change A has an `## ADDED` delta for a capability with no main spec that change B modifies; then A blocks B.
- **L3:** shared-capability overlap, recorded as undirected `overlaps` that never block.

Declared edges SHALL take precedence over inferred ones for the same pair. `not_blocked_by` SHALL suppress declared and inferred edges to the named change. Each edge SHALL carry `source` (`declared` | `inferred-text` | `inferred-capability`) and a `reason`. Output SHALL be sorted so identical repository state yields byte-identical results. Inferred edges SHALL NOT be written to any file.

#### Scenario: Mutual mentions do not create a cycle

- **GIVEN** `add-acme-dns01-certs` says "Depends on: `add-tailscale-cert-tls`" and `add-tailscale-cert-tls` says "Follow-up: `add-acme-dns01-certs` adds a second certificate source"
- **WHEN** inference runs
- **THEN** there SHALL be exactly one edge: `add-acme-dns01-certs` blocked by `add-tailscale-cert-tls`
- **AND** no cycle issue SHALL be reported

#### Scenario: Capability names are not edges

- **WHEN** a proposal says "builds on `pi-core-version-ui`" and no change of that name exists
- **THEN** no edge and no issue SHALL be produced for that token

#### Scenario: Capability birth orders two changes

- **GIVEN** change `add-push` has `specs/push-notifications/spec.md` with `## ADDED Requirements` and no main spec `push-notifications` exists
- **AND** change `add-ntfy` has a `specs/push-notifications/spec.md` delta with `## MODIFIED Requirements`
- **THEN** `add-ntfy` SHALL be blocked by `add-push` with `source: inferred-capability`

#### Scenario: Rejected inference stays rejected for everyone

- **GIVEN** inference yields `foo` blocked by `bar`
- **WHEN** `foo/dependencies.yaml` lists `not_blocked_by: [bar]`
- **THEN** no `foo` → `bar` edge SHALL be reported on any machine with that file

#### Scenario: Determinism

- **WHEN** the graph is computed twice for an unchanged repository
- **THEN** the serialized `dependencies` payloads SHALL be identical

### Requirement: Names resolve against active, archived and sibling-worktree changes

Each referenced name SHALL resolve, in order, to:
- an active change in this checkout: the edge is open;
- an archived change (`archive/<YYYY-MM-DD>-<name>`): the edge is satisfied;
- an active change in another known cwd sharing this repository's git common directory: the edge is `external`, open, with info severity;
- otherwise unknown: the edge is ignored for waves and gets a warning `unknown-change`.

#### Scenario: Archived blocker is satisfied

- **WHEN** `foo` is blocked by `bar` and `bar` exists only under `archive/2026-10-01-bar`
- **THEN** the edge SHALL be `satisfied` and SHALL NOT delay `foo`'s wave

#### Scenario: Blocker pending in another worktree

- **WHEN** `bar` exists only in the worktree `.worktrees/bar` of the same repository
- **THEN** `foo`'s edge to `bar` SHALL be `external` and open

### Requirement: Dependency graph is validated

The server SHALL report per-change `issues` with severity:
- `error`: `invalid-file` (unparseable YAML or wrong shape), `self-reference`, and `cycle` (with the cycle path, detected over open edges among active changes).
- `warning`: `unknown-change`, `conflicting-entry` (a name in both `blocked_by` and `not_blocked_by`; `not_blocked_by` wins), and `duplicate-capability` (two changes both ADD the same new capability).

OpenSpec's own validation does not check this file, so this validator SHALL be the only content check.

#### Scenario: Cycle is reported on every member

- **WHEN** `a` is blocked by `b` and `b` is blocked by `a`
- **THEN** both `a` and `b` SHALL carry a `cycle` error listing `a → b → a`

#### Scenario: Self reference

- **WHEN** `a` lists itself in `blocked_by`
- **THEN** `a` SHALL carry a `self-reference` error and the entry SHALL be ignored

### Requirement: Execution waves

The server SHALL assign each active change a `wave` by topological layering (Kahn) over open edges:
- wave 1 has no open blockers;
- a change with an `external` blocker starts at wave 2 or later and is flagged;
- changes in a cycle get `wave: null`;
- ties are ordered by name.

`OpenSpecChange.dependencies` SHALL be `{ blockedBy, blocks, related, overlaps, wave, issues }`, where `blocks` is the computed inverse over open and satisfied edges.

#### Scenario: Three-change chain

- **GIVEN** `c` blocked by `b`, `b` blocked by `a`, all active
- **THEN** waves SHALL be `a: 1`, `b: 2`, `c: 3`
- **AND** `a.blocks` SHALL list `b`

#### Scenario: Archiving advances the next change

- **WHEN** `a` is archived
- **THEN** on the next poll `b` SHALL be wave 1 and `c` wave 2

### Requirement: Dependencies file is a tracked path for every change

`dependencies.yaml` SHALL be included in each change's watcher filter and change-detection tracked paths regardless of schema, so creating or editing it triggers one debounced gated re-poll.

#### Scenario: Editing a spec-driven change's dependencies refreshes the board

- **GIVEN** a `spec-driven` change (no dependencies artifact in its schema)
- **WHEN** its `dependencies.yaml` is written
- **THEN** a gated re-poll SHALL run within the watcher debounce window and the broadcast SHALL carry the new edges

### Requirement: Dependencies REST endpoints are gated and contained

- `GET /api/openspec/dependencies?cwd=&change=` SHALL return the computed `dependencies` entry.
- `PUT /api/openspec/dependencies` with `{ cwd, change, blockedBy, notBlockedBy, related }` SHALL write `dependencies.yaml` atomically.

Both endpoints SHALL apply the `openspec_refresh` admission gates before any filesystem access. `change` SHALL be a member of the cwd's current change list. Every name SHALL satisfy `isValidOpenSpecChangeSlug`. The target path SHALL be contained by `<root>/openspec/changes/<change>/`. Request bodies over 64 KiB SHALL be rejected.

#### Scenario: Path traversal is rejected

- **WHEN** `PUT` names `change: "../../etc"`
- **THEN** the server SHALL reject the request without filesystem access

#### Scenario: Unknown change is rejected

- **WHEN** `PUT` names a change that is not in the cwd's current change list
- **THEN** the server SHALL reject the request and write nothing
