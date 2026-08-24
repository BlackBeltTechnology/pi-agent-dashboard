## ADDED Requirements

### Requirement: Setup state is a per-artifact checklist, not a boolean

`WorktreeInitStatus.configured?: boolean` SHALL be replaced by a per-artifact checklist reporting, for each known setup artifact, its identity, whether it is present, and whether it is **required**. A boolean cannot express a repo that has `openspec/` but no `AGENTS.md`, which is the common real state.

The checklist SHALL be produced by a `stat` of a known artifact list, resolved against the **config root** — the same base the existing `configured` boolean uses — and not against the row's own `cwd`. For a git worktree the config root is the main checkout, so stat'ing `cwd` would report every worktree as unconfigured.

The artifact set SHALL be exactly these five entries, and the tally denominator `N` SHALL therefore be 5:

| id | path (relative to config root) | required |
|---|---|---|
| `settings` | `.pi/settings.json` | **yes** |
| `agents` | `AGENTS.md` | no |
| `prompts` | `.pi/prompts/` (directory exists) | no |
| `openspec` | `openspec/` (directory exists) | no |
| `kb` | `.pi/dashboard/knowledge_base.json` | no |

Exactly one artifact is required: `settings`. The DOX doctrine is **not** a member — the scaffold appends it into `AGENTS.md` rather than writing a distinct file, so it has nothing of its own to stat.

The checklist SHALL be computed for **every** init-status response, including one where a hook is declared. Today the boolean is computed only when no hook exists, which leaves a hook-declaring repo unable to report its setup state at all.

The checklist SHALL NOT reuse the gate cache, and SHALL NOT be cached at all. The gate cache is populated only on the trusted-hook branch and invalidated only by a hook run, so a no-hook directory — the only kind that can raise a setup banner — would never gain an entry and never be invalidated. A dedicated cache is rejected too: its correct invalidation trigger is "a project-init session completed here", and the session manager exposes no lifecycle event to hang that on. The probe is a handful of `stat` calls against an already-resolved path, so it SHALL be computed fresh on every response and SHALL never serve a stale answer.

The probe SHALL report the checklist as **unknown** using a single agreed representation: the checklist field is **omitted** from the response. There SHALL NOT be a second "unknown" encoding such as a null or a sentinel object — one absent-means-unknown shape, consumed identically by every client.

The checklist SHALL NOT introduce hashing, content inspection or template comparison — that is a separate concern (see `setupOutdated`).

The probe SHALL fail open: on error the endpoint SHALL report the checklist as unknown rather than reporting artifacts as absent.

#### Scenario: Partial setup is representable

- **GIVEN** a directory containing `openspec/` but no `AGENTS.md`
- **WHEN** init-status is probed
- **THEN** the checklist SHALL report `openspec` present and `AGENTS.md` absent
- **AND** the response SHALL NOT collapse this to `configured: false`

#### Scenario: Required and optional artifacts are distinguishable

- **WHEN** the checklist is returned
- **THEN** each entry SHALL declare whether it is required
- **AND** exactly one entry, `.pi/settings.json`, SHALL be marked required

#### Scenario: Worktree resolves its checklist against the main checkout

- **GIVEN** a git worktree whose own directory has no `.pi/settings.json` but whose main checkout does
- **WHEN** init-status is probed for the worktree
- **THEN** the checklist SHALL report `.pi/settings.json` present

#### Scenario: A hook-declaring repo still reports its checklist

- **GIVEN** a directory whose config root declares a `worktreeInit` hook
- **WHEN** init-status is probed
- **THEN** the response SHALL carry the checklist alongside the hook fields

#### Scenario: Probe error reports unknown, not absent

- **GIVEN** the artifact probe throws
- **WHEN** init-status is returned
- **THEN** the checklist field SHALL be omitted from the response
- **AND** SHALL NOT report every artifact as absent

#### Scenario: Checklist reflects a scaffold on the next probe

- **GIVEN** a directory whose checklist reports `.pi/settings.json` absent
- **WHEN** the file is created and init-status is probed again
- **THEN** the probe SHALL report the artifact present
- **AND** SHALL NOT serve a stale checklist

### Requirement: Init-status declares a template-staleness field

`WorktreeInitStatus` SHALL declare an optional `setupOutdated?: boolean`, meaning "the directory's setup files have fallen behind the current templates". This is distinct from `hookDefHash` trust, which answers a security question (repo-provided bash may not run until re-confirmed) and not a freshness one.

Detection is out of scope for this change: no server code SHALL emit `setupOutdated` yet. The field exists so the client can render its menu badge, and consumers SHALL treat an absent field as "not outdated".

#### Scenario: Absent field means not outdated

- **WHEN** init-status omits `setupOutdated`
- **THEN** consumers SHALL treat the directory as not outdated

#### Scenario: Staleness is not conflated with trust

- **GIVEN** a directory whose `hookDefHash` changed
- **WHEN** init-status is returned
- **THEN** the trust state SHALL be reported as revoked
- **AND** `setupOutdated` SHALL NOT be set as a consequence of the hash change
