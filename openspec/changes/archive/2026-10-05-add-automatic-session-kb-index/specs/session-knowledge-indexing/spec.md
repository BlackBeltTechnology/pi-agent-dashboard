# session-knowledge-indexing — delta

## ADDED Requirements

### Requirement: Headless index-only distillation
The session-distiller SHALL provide an `--index-only` mode that harvests, segments, and
extracts verified signals from pi session JSONL and writes them to the `packages/kb`
FTS5 store WITHOUT any live agent in the loop. It SHALL be mutually exclusive with
`--apply`, and SHALL advance the watermark identically to the existing pipeline.

#### Scenario: Index-only run over a fixture session
- **WHEN** `distiller --index-only --cwd <repo>` runs over a session containing a fault, a correction, an ask_user decision, a procedure, and a documentation summary
- **THEN** exactly five chunks SHALL be written to the kb store, each carrying `signal`, `sessionId`, `cwd`, `confidence`, and `verified` metadata
- **AND** no `skill_manage` / `memory` / `docs` write SHALL occur

#### Scenario: Index-only rejects --apply combination
- **WHEN** both `--index-only` and `--apply` are passed
- **THEN** the process SHALL exit non-zero with an error naming the conflict

### Requirement: Every verified signal class is indexable
The `kb` sink SHALL accept all five signal classes (fault, correction, decision,
procedure, documentation) gated on `verified === true` ALONE — a single verified
sighting SHALL be indexable. The `N≥3` recurrence gate SHALL continue to apply ONLY to
the `--apply` promotion path (skills/memory), never to the index path.

#### Scenario: Single verified artifact indexed but not promoted
- **WHEN** a verified fault-recovery appears in exactly one session and `--index-only` runs
- **THEN** it SHALL be indexed into the kb store
- **AND** it SHALL NOT be written as a skill or memory entry (that still requires recurrence)

### Requirement: Mandatory scrub gate in the headless path
Before any chunk is written, the index path SHALL scrub secrets/tokens, PII, and
absolute local paths, drop inline base64 `image` blocks, and strip `thinkingSignature`.
A `secretScan` SHALL run on the scrubbed chunk and SHALL fail closed: a chunk that still
matches a secret pattern SHALL NOT be written.

#### Scenario: Planted secret blocks the write
- **WHEN** a tool result in the session contains an `auth.json`-shaped token AND `--index-only` runs
- **THEN** the scrub SHALL redact it, and if any secret pattern survives, that chunk SHALL be skipped and counted in `scrubbed`/`skipped`
- **AND** no un-redacted secret SHALL appear in the kb store

#### Scenario: Absolute paths normalized
- **WHEN** session content references `/Users/<user>/Project/<repo>/src/x.ts`
- **THEN** the indexed chunk SHALL store a normalized `<repo>/src/x.ts` form, not the machine-specific absolute path

### Requirement: Lifecycle-triggered automatic indexing
The dashboard server SHALL trigger `--index-only` from session-lifecycle transitions it
already tracks — NOT from a bespoke file-idle heuristic. It SHALL fire on `LiveIdle`
sustained ≥ `T_idle` and on `Ended` (`alive→ended`), guarded by a per-session lock, and
SHALL wait `T_crash` for reconnect when `Ended` arrives as an unclean WS drop.

#### Scenario: Session goes idle then ends
- **WHEN** a monitored session emits `agent_end`+`isIdle` and stays quiescent past `T_idle`
- **THEN** exactly one index run SHALL be spawned for that session
- **AND WHEN** the session later transitions to `Ended`, a final index run SHALL be spawned, and the per-session lock SHALL prevent overlap

#### Scenario: Resumed session re-indexes idempotently
- **WHEN** an `Ended` session is reattached (`session_register`) and produces new turns, then goes idle again
- **THEN** a subsequent index run SHALL add only the new artifacts, and unchanged artifacts SHALL be no-ops by content hash

### Requirement: Subagent sessions excluded by default
Subagent-origin sessions SHALL be excluded from automatic indexing by default. An
explicit `--include-subagents` flag SHALL opt them in. Skips SHALL be counted in the run
summary.

#### Scenario: Subagent session skipped
- **WHEN** `--index-only` encounters a subagent-origin session without `--include-subagents`
- **THEN** it SHALL be skipped and counted, and no chunk from it SHALL be written
