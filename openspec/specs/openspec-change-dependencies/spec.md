# openspec-change-dependencies Specification

## Purpose
Change-to-change dependencies for OpenSpec changes: a committed per-change `dependencies.yaml`, deterministic inference from structured proposal lines and spec deltas, a validated dependency graph with execution waves, and REST access for the board and ship-it.

## Requirements

### Requirement: Per-change dependencies file

A change MAY carry `openspec/changes/<name>/dependencies.yaml` with optional keys `blocked_by` (list of `{ change, reason? }` or bare names), `not_blocked_by` (list of names) and `related` (list of names). The file SHALL be parsed with the `yaml` package using the `failsafe` schema (every scalar is a string, so a name such as `123` stays a name) and with aliases rejected (`maxAliasCount: 0`); the file SHALL be opened only when `lstat` reports a regular file that is not a symlink, and at most 64 KiB + 1 byte SHALL be read; a symlink, a non-regular file or a larger file is `invalid-file`. These read rules apply wherever the file is read (poll derivation, GET, the ship-it gate script). An empty or comment-only file, and a key whose value is empty (`blocked_by:`), SHALL mean "no dependencies" for that file or key. Any top-level key other than the three SHALL make the file `invalid-file` (catches `blocks:` and typos). `blocks` SHALL NOT be stored; it SHALL always be computed as the inverse of `blocked_by`. Empty lists SHALL be a valid explicit "no dependencies" declaration. The file SHALL be honoured for every schema. Every name SHALL match OpenSpec's change-id grammar (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`); a non-matching entry SHALL make the file `invalid-file`. A `reason` SHALL be a string of at most 500 characters; a longer one makes the file `invalid-file`.

#### Scenario: Shorthand and long form are equivalent

- **WHEN** one change declares `blocked_by: [add-x]` and another `blocked_by: [{ change: add-x, reason: "api" }]`
- **THEN** both SHALL produce an open `declared` edge to `add-x` (the second with its reason)

#### Scenario: Oversized or aliased file is invalid

- **WHEN** `dependencies.yaml` exceeds 64 KiB or contains a YAML alias
- **THEN** the change SHALL carry an `invalid-file` error issue and no declared edges

#### Scenario: Names follow OpenSpec's grammar

- **WHEN** `blocked_by` lists `100-add-feature` and `Bad_Name`
- **THEN** `100-add-feature` SHALL be accepted
- **AND** `Bad_Name` SHALL make the file `invalid-file`

### Requirement: Dependency inference is deterministic and never written to disk

The server SHALL compute the dependency graph in the poll derivation (in the poll worker, or in-process with identical output when the worker is disabled or unavailable) on every `status --all` poll that rebuilds a directory's data, from repository content only. On the fallback poll path (CLI without `status --all`) the graph SHALL NOT be computed and changes SHALL carry no `dependencies` field.

- **L1 (structured lines):** in `proposal.md`, a line that starts — after optional indentation and an optional list marker (`-`, `*` or `<n>.`) — with one of the labels `Blocked by`, `Depends on`, `Builds on` or `Blocks` (case-insensitive, optionally bold, optionally followed by one parenthetical such as `(land first)`), followed by `:` — inside or outside the bold markers — or by whitespace and a backticked token, together with its continuation lines and nested items. Other label spellings (e.g. `Blocks on`) are not labels. Lines inside fenced code blocks are ignored. A token naming the proposal's own change is ignored (no edge, no issue, no `related`); a token that resolves to no active or archived change is ignored without an issue; under `Blocks`, a token naming an archived change is ignored (an archived change cannot be blocked). Backticked tokens there that resolve to an active or archived change name produce an edge: the first three labels make this change blocked by the named change; `Blocks` makes the named change blocked by this one. The `## Dependencies` section is the recommended home for these lines.
- **Prose mentions:** a backticked token anywhere else in `proposal.md` (outside fenced code) that resolves to another active change name SHALL produce a `related` entry, never a blocking edge.
- **L2 (capability birth):** capability ids follow OpenSpec's spec discovery: the path of a `spec.md` relative to `specs/` without the file name (e.g. `push-notifications`, `area/feature`). `<cap>` is unborn when no main spec `openspec/specs/<cap>/spec.md` exists. A *delta for `<cap>`* is the file `specs/<cap>/spec.md` in an active change; section headers are matched case-insensitively, outside fenced code, like OpenSpec's parser. It *modifies* when it contains a `## MODIFIED Requirements`, `## REMOVED Requirements` or `## RENAMED Requirements` header, and it *adds only* when it contains `## ADDED Requirements` and none of those. A birther of an unborn `<cap>` is an active change whose delta adds only. With exactly one birther A, every other active change whose delta for `<cap>` has at least one of the four headers SHALL be blocked by A. With two or more birthers, no L2 edge SHALL be produced for `<cap>` and each birther SHALL carry a `duplicate-capability` warning naming the others. A delta with none of the four headers is neither a birther nor blocked.
- **L3:** two active changes with deltas for the same capability get an undirected `overlaps` entry that never blocks.

Edges are keyed by the ordered pair (blocked change, blocker). For the same ordered pair, a declared edge SHALL take precedence over an inferred one. A change's `not_blocked_by` SHALL suppress every edge where that change is the blocked side and the named change the blocker, whichever file or proposal produced it. Each edge SHALL carry `source` (`declared` | `inferred-text` | `inferred-capability`) and a `reason` (the matched line with `\r` removed and whitespace runs collapsed to one space, truncated to 200 characters, or the capability name). Output SHALL be sorted so identical repository state yields byte-identical results; it SHALL NOT depend on which other directories the dashboard tracks, on line endings, or on the host OS. Inferred edges SHALL NOT be written to any file.

To bound cost, per-file parse results (proposal lines, delta section headers, `dependencies.yaml`) SHALL be cached by path, mtime and size wherever the derivation runs; the graph is recomputed from the cached parts on every rebuild. The graph SHALL always be computed from the files read in the current build, for every active change, and every change's `dependencies` field SHALL be replaced from it — including a change whose other fields the TOCTOU check keeps from the previous entry — so `blocks` and `blockedBy` in one payload are always inverse. An unreadable or half-written file yields `invalid-file` for that build and is corrected by the next build that sees its mtime advance.

#### Scenario: Mutual prose mentions do not create a cycle

- **GIVEN** `add-acme-dns01-certs` has the item "**Depends on**: `add-tailscale-cert-tls` …" and `add-tailscale-cert-tls` mentions `add-acme-dns01-certs` in a "Follow-up" sentence that is not a labelled line
- **WHEN** inference runs
- **THEN** there SHALL be exactly one edge: `add-acme-dns01-certs` blocked by `add-tailscale-cert-tls`
- **AND** `add-tailscale-cert-tls` SHALL list `add-acme-dns01-certs` as `related`
- **AND** no cycle issue SHALL be reported

#### Scenario: Prose keywords never block

- **WHEN** a proposal says "`add-kb-worktree-seed` depends on this change" or "advert plus pin-after-proof (`stabilize-mdns-server-identity`)" outside a labelled line
- **THEN** no blocking edge SHALL be produced, only `related` entries

#### Scenario: Label variants

- **WHEN** proposals contain "Depends on: `a`" as a paragraph, "**Depends on** `a` (must ship first)", "1. Builds on `a`", "- **Depends on (land first):** `a`", "**Blocks:** `a`" and "Blocks on: `a`"
- **THEN** the first four SHALL make the change blocked by `a`, the fifth SHALL make `a` blocked by it, and the last SHALL produce only a `related` entry

#### Scenario: Capability names are not edges

- **WHEN** a labelled line names `pi-core-version-ui` and no active or archived change of that name exists
- **THEN** no edge and no issue SHALL be produced for that token

#### Scenario: Follow-up that both adds and modifies

- **GIVEN** `add-push` adds only to the unborn `push-notifications`
- **AND** `add-ntfy`'s delta for it has both `## ADDED Requirements` and `## MODIFIED Requirements`
- **THEN** `add-ntfy` SHALL be blocked by `add-push` and no `duplicate-capability` SHALL be reported

#### Scenario: Capability birth orders two changes

- **GIVEN** change `add-push` has `specs/push-notifications/spec.md` with `## ADDED Requirements` and no main spec `push-notifications` exists
- **AND** change `add-ntfy` has a `specs/push-notifications/spec.md` delta with only `## MODIFIED Requirements`
- **THEN** `add-ntfy` SHALL be blocked by `add-push` with `source: inferred-capability`

#### Scenario: Two changes adding the same new capability

- **GIVEN** `add-dedicated-agent-browser` and `add-gmail-auto-setup` both have `## ADDED Requirements` deltas for the unborn `dedicated-agent-browser`
- **THEN** neither SHALL be blocked by the other through L2
- **AND** both SHALL carry `duplicate-capability` naming the other

#### Scenario: Rejected inference stays rejected for everyone

- **GIVEN** inference yields `foo` blocked by `bar`, from either proposal
- **WHEN** `foo/dependencies.yaml` lists `not_blocked_by: [bar]`
- **THEN** no `foo` → `bar` edge SHALL be reported on any machine with that file

#### Scenario: Determinism across machines

- **GIVEN** two dashboards with the same repository state, one on Windows with CRLF checkouts and tracking an extra worktree of the repository
- **WHEN** both compute the graph
- **THEN** the serialized `dependencies` payloads SHALL be identical

#### Scenario: Old CLI has no graph

- **WHEN** the cwd is polled on the fallback path
- **THEN** no change SHALL carry a `dependencies` field

### Requirement: Names resolve against active and archived changes

Each referenced name SHALL resolve, in order, to:
- an active change in this checkout, enumerated like OpenSpec's `getActiveChangeIds` (directories under `openspec/changes/` except `archive` and names starting with `.`): the edge is open;
- an archived change, matched only by a directory named exactly `<YYYY-MM-DD>-<name>` under `openspec/changes/archive/`: the edge is satisfied;
- otherwise unknown. An unknown name in a declared `blocked_by` SHALL get a warning `unknown-change` and be ignored for waves; unknown names in `related` and `not_blocked_by`, and unresolved inferred tokens, SHALL be ignored without an issue.

Archive entries whose name carries an extra prefix after the date (e.g. `2026-05-28-SUPERSEDED-<name>`) SHALL NOT satisfy `<name>`.

#### Scenario: Archived blocker is satisfied

- **WHEN** `foo` is blocked by `bar` and `bar` exists only under `archive/2026-10-01-bar`
- **THEN** the edge SHALL be `satisfied` and SHALL NOT delay `foo`'s wave

#### Scenario: Shelved archive entry does not satisfy

- **WHEN** `foo` is blocked by `bar` and the only archive entry is `archive/2026-05-28-SHELVED-bar`
- **THEN** `foo` SHALL carry `unknown-change` for `bar`

#### Scenario: Blocker pending in another worktree

- **WHEN** `bar` exists only in the tracked worktree `.worktrees/bar` of the same repository
- **THEN** `foo` SHALL carry `unknown-change` for `bar`

### Requirement: Dependency graph is validated

The server SHALL report per-change `issues` with severity:
- `error`: `invalid-file` (unparseable YAML, wrong shape, invalid name), `self-reference`, and `cycle` when every edge of the cycle is `declared`.
- `warning`: `cycle` when the cycle contains at least one inferred edge, `blocked-by-cycle` (the change has an open path to a cycle member), `unknown-change`, `conflicting-entry` (a name in both `blocked_by` and `not_blocked_by`; `not_blocked_by` wins), and `duplicate-capability`.

Cycles SHALL be detected over open edges among active changes with Tarjan SCC, twice: on the declared-only subgraph (every member of a non-trivial SCC gets a `cycle` error) and on the full graph (members of a non-trivial SCC without an error get a `cycle` warning). Each issue SHALL list one canonical path: the shortest cycle through the SCC's smallest-named member, ties broken by lexicographic order of the path. OpenSpec's own validation does not check this file, so this validator SHALL be the only content check.

#### Scenario: Declared cycle is an error on every member

- **WHEN** `a` declares `b` in `blocked_by` and `b` declares `a`
- **THEN** both `a` and `b` SHALL carry a `cycle` error listing `a → b → a`

#### Scenario: Cycle through an inferred edge is a warning

- **WHEN** `a` declares `b` and an L2 edge makes `b` blocked by `a`
- **THEN** both SHALL carry a `cycle` warning naming the inferred edge

#### Scenario: Self-reference

- **WHEN** `a` lists itself in `blocked_by`
- **THEN** `a` SHALL carry a `self-reference` error and the entry SHALL be ignored

### Requirement: Execution waves

The server SHALL assign each active change a `wave` by topological layering (Kahn) over open edges among active changes:
- a change with no open blockers is wave 1;
- otherwise its wave is 1 + the maximum wave of its open blockers;
- cycle members and every change with an open path to a cycle member get `wave: null`;
- ties are ordered by name.

`OpenSpecChange.dependencies` SHALL be `{ hasFile, blockedBy, blocks, related, overlaps, wave, issues }`. `hasFile` tells whether `dependencies.yaml` exists. `blockedBy` lists open and satisfied edges with their state. `blocks` lists the active changes that have an open edge to this change.

#### Scenario: Three-change chain

- **GIVEN** `c` blocked by `b`, `b` blocked by `a`, all active
- **THEN** waves SHALL be `a: 1`, `b: 2`, `c: 3`
- **AND** `a.blocks` SHALL list `b`

#### Scenario: Archiving advances the next change

- **WHEN** `a` is archived
- **THEN** on the next poll `b` SHALL be wave 1 and `c` wave 2

#### Scenario: Downstream of a cycle

- **GIVEN** `a` and `b` form a cycle and `c` is blocked by `b`
- **THEN** `a`, `b` and `c` SHALL have `wave: null`
- **AND** `c` SHALL carry `blocked-by-cycle`

### Requirement: Per-poll dependency cost is bounded

A rebuild in which at most one input file of the graph changed SHALL compute the graph for 100 active changes in under 20 ms (median of 20 runs), in the worker and in the in-process derivation alike. In-process, the graph computation is part of the post-call build and counts toward that build's existing per-turn main-thread budget. The extra probe paths (see `server-openspec-polling`) use the capability ids from the previous build, stored with the cwd's gate stamp; when they are absent (cold start, worker restart, fallback to in-process) the gate SHALL NOT skip, so the next build re-establishes them. The cold first computation SHALL be measured on macOS and Windows and recorded in `docs/architecture.md`; it has no hard threshold. Each rebuild SHALL emit one debug log line with edge counts by source, issue counts by severity and the compute time.

#### Scenario: Rebuild after one edit

- **GIVEN** a fixture of 100 active changes with proposals and deltas, cache warm
- **WHEN** one `proposal.md` is edited and the graph is recomputed
- **THEN** the measured median over 20 runs SHALL be under 20 ms

### Requirement: Dependencies REST endpoints are gated and contained

- `GET /api/openspec/dependencies?cwd=&change=` SHALL return `{ dependencies, declared, declaredError, file }`: the computed entry from the cache; the file's own `{ blockedBy: [{ change, reason? }], notBlockedBy, related }` read fresh under the read rules (`null` when there is no file or it is invalid); the `invalid-file` message when it is invalid (else `null`); and `file: { mtimeMs, size } | null`. The editor edits `declared`, never the computed lists, and preserves reasons.
- `PUT /api/openspec/dependencies` with `{ cwd, change, blockedBy, notBlockedBy, related }` SHALL write `dependencies.yaml`.

Both SHALL be registered in `packages/shared/src/route-tiers.ts` (GET `observe`, PUT `control`), in the MCP manifest and in the HTTP road classification. Both SHALL use `preHandler: networkGuard`, like the other `/api/openspec/*` routes. PUT replaces the whole file (hence the verb). Both SHALL check, in this order, answering with the listed status and `reason`:
1. `change` matches the change-id grammar and, for PUT, the body is valid — at most 64 KiB, every name matches the grammar and differs from `change`, every `reason` ≤ 500 characters, `expected` present (no filesystem access before this) → else 400 `invalid-request`;
2. `cwd` tracked (session registry or pinned) → else 403 `cwd-not-tracked`;
3. OpenSpec globally enabled → else 403 `openspec-disabled`;
4. cwd not opted out → else 403 `opted-out`;
5. `<cwd>/openspec/` exists → else 404 `no-openspec-dir`;
6. the cwd is not classified as polled on the fallback path → else 409 `status-all-unsupported`;
7. a successful `status --all` result is cached for the cwd → else 503 `pending`;
8. `change` is in the cached change list → else 404 `unknown-change`.

PUT SHALL then, in this order:
1. apply the `openspec-workflow-schema` write guard ("Every writing action verifies the root first"), and refuse when the change directory or an existing `dependencies.yaml` is a symlink or not a regular file, or when the directory's realpath is not under the canonical `<cwd>/openspec/changes/`;
2. take the workflow-schema lock for the same canonical cwd (409 `locked` when held);
3. check the precondition `expected`, which is the `file` value from GET: when it is `null` the file SHALL NOT exist; otherwise its mtime and size SHALL both match — else 409 `modified`;
4. produce the content through the YAML serializer (never string concatenation; existing comments are not preserved), write a temporary file in the same directory, and move it into place: by rename when `expected` is non-null, and by an exclusive no-replace operation (`link` then remove the temporary file) when `expected` is `null`, answering 409 `modified` if the file appeared meanwhile;
5. log one structured line with cwd, change and entry counts.

Agents writing the file directly do not take the lock; the precondition makes such a concurrent edit visible as 409 `modified` except within one filesystem timestamp tick of identical size, which is accepted.

#### Scenario: Path traversal is rejected

- **WHEN** `PUT` names `change: "../../etc"`
- **THEN** the server SHALL answer 400 `invalid-request` without any filesystem access

#### Scenario: Unknown change is rejected

- **WHEN** `PUT` names a change that is not in the cwd's current change list
- **THEN** the server SHALL reject the request and write nothing

#### Scenario: Symlinked change directory is refused

- **WHEN** `openspec/changes/foo` is a symlink to a directory outside the repository
- **THEN** `PUT` for `foo` SHALL be refused and nothing SHALL be written

#### Scenario: Concurrent edit is detected

- **GIVEN** the editor read `foo/dependencies.yaml` as `{ mtimeMs: T, size: 120 }` and an agent rewrote it afterwards
- **WHEN** `PUT` is sent with that `expected`
- **THEN** the server SHALL answer 409 `modified` and write nothing

#### Scenario: First declaration races an agent

- **GIVEN** GET returned `file: null` for `foo` and an agent then created `foo/dependencies.yaml`
- **WHEN** `PUT` is sent with `expected: null`
- **THEN** the server SHALL answer 409 `modified` and the agent's file SHALL be unchanged

#### Scenario: Symlinked dependencies file is never read

- **WHEN** `foo/dependencies.yaml` is a symlink to `/dev/zero`
- **THEN** the poll and GET SHALL report `invalid-file` without reading through it

#### Scenario: Reason cannot inject keys

- **WHEN** a `reason` is `"x\nnot_blocked_by: [a]"`
- **THEN** the written file SHALL parse back to the same single `blocked_by` entry with that literal reason and an empty `not_blocked_by`
