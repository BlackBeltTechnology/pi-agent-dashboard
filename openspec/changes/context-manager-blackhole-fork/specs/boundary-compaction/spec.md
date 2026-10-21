## ADDED Requirements

### Requirement: Threshold compaction is delivered on pi's boundary API
While the context manager is active, threshold compaction SHALL be delivered by returning a compaction entry draft (`{ type: "compaction", summary, firstKeptEntryId, details }`) from a boundary event, never by calling or patching `AgentSession` internals.

- With `midRunCompaction: "off"` (the default), the draft SHALL be returned from `agent_before_settle`.
- With `midRunCompaction: "resume"`, it SHALL also be returned from `turn_end`.
- With `midRunCompaction: "pause"`, compaction at `turn_end` of a persisted session SHALL use the public `ctx.compact()`, as upstream does; at end of run the draft SHALL be returned from `agent_before_settle` as in the other modes.
- A non-persisted session SHALL use the boundary draft at both `turn_end` and `agent_before_settle`, in every mode, and SHALL never call `ctx.compact()`.
- The draft's `details` SHALL carry `"context-manager.boundary": true`; compactions produced through `session_before_compact` SHALL NOT carry it.
- The compaction consumer SHALL return the `entries` it received followed by the draft, and SHALL NOT set `continue`.

#### Scenario: End-of-run compaction
- **WHEN** a run ends with the tokens since the last compaction above the threshold and `midRunCompaction` is `off`
- **THEN** the session's branch gains one `compaction` entry after the run's last message
- **AND** the next prompt's request carries that entry's summary and no message before its `firstKeptEntryId`

#### Scenario: Mid-run compaction
- **WHEN** `midRunCompaction` is `resume` and a turn with pending tool results ends above the threshold
- **THEN** the run's next request carries the compaction summary and the kept entries, and the run continues without being aborted

#### Scenario: Non-persisted session
- **WHEN** an in-memory session (`SessionManager.inMemory`) ends a run above the threshold, in any `midRunCompaction` mode
- **THEN** the compaction entry is in the session before `agent_settled` fires
- **AND** `ctx.compact()` is not called

### Requirement: Compaction runs only when its gates allow
The compaction consumer SHALL return no draft when any of these hold: compaction mode is not automatic, the provider is in `skipForProviders`, a compaction is already in flight, the run's signal is aborted, the retry backoff is active, the tokens since the last compaction are below `autoCompactThreshold(config, model)`, the boundary's context messages end with an unpaired tool call, the previous boundary of the session produced a compaction, for `agent_before_settle` only the run already produced a compaction (through a draft, a `ctx.compact()` the fork called, or pi itself), the incoming boundary `entries` already hold a compaction draft, the preparation is undefined (the branch ends with a compaction or nothing can be summarized), or pi's compaction settings for the session model are invalid. Whether a compaction was produced SHALL be read from persisted session entries and from a per-run record of the fork's own `ctx.compact()` calls, never from drafts returned earlier. At most one compaction draft SHALL be returned per boundary event. A skipped compaction caused by an error SHALL produce one `[context-manager]` warning per session.

#### Scenario: Unpaired tool call
- **WHEN** the threshold holds but the branch ends with a tool call that has no result
- **THEN** no compaction draft is returned at that boundary

#### Scenario: No back-to-back compaction
- **WHEN** a `turn_end` produced a compaction and the next `turn_end` is still above the threshold
- **THEN** the next `turn_end` returns no compaction draft

#### Scenario: One compaction per run
- **WHEN** `midRunCompaction` is `pause`, a persisted session's `turn_end` calls `ctx.compact()`, and the run then settles above the threshold
- **THEN** `agent_before_settle` returns no compaction draft

#### Scenario: Repeated mid-run compaction
- **WHEN** `midRunCompaction` is `resume` and a long run crosses the threshold at turn 3 and again at turn 9
- **THEN** both `turn_end` boundaries return a compaction draft

#### Scenario: A draft pi did not persist suppresses nothing
- **WHEN** a `turn_end` draft on the run's final turn is not persisted and the run settles above the threshold
- **THEN** `agent_before_settle` returns a compaction draft

#### Scenario: Another extension's draft
- **WHEN** the incoming `agent_before_settle` entries already hold a compaction draft from another extension
- **THEN** the fork returns no compaction draft

#### Scenario: Trailing non-message entries
- **WHEN** the branch ends with a custom entry after an assistant tool call that has no result
- **THEN** no compaction draft is returned at that boundary

#### Scenario: Builder failure
- **WHEN** building the summary throws
- **THEN** no draft is returned, the retry backoff is recorded, the run continues, one `compaction.boundary.failed` debug record names the error class, and one `[context-manager]` warning is logged for the session

#### Scenario: Threshold check budget
- **WHEN** 1,000 boundary events are evaluated below the threshold on a 2,000-entry branch
- **THEN** the p95 evaluation time is below 2 ms

### Requirement: The boundary path builds pi's own preparation
For a boundary draft, the fork SHALL compute the compaction `preparation` (`firstKeptEntryId`, `messagesToSummarize`, `turnPrefixMessages`, `isSplitTurn`, `tokensBefore`, `previousSummary`, `fileOps`, `settings`) with a vendored copy of pi 1.3.0's `prepareCompaction` and its helpers, over the session branch, with compaction settings resolved from the public `pi.getSettings()` by pi's per-field rule (model override, then ordinary setting, then default). The vendored files SHALL carry a header naming the pi version and source file and the MIT licence, and `NOTICE` SHALL name pi. The upstream builder SHALL then apply `tailBehavior` and render the summary from that `preparation`; upstream's "compact everything" result SHALL be expressed as `firstKeptEntryId: null`.

#### Scenario: Preparation parity with pi
- **WHEN** the same branch is compacted once through a boundary draft and once through pi's real `session_before_compact`, for each of: a plain branch, a branch with a context edit omitting a tool result, a branch after a previous compaction, a branch after a retain-none compaction, a split turn, and a session model with a `keepRecentTokens` override
- **THEN** the two `preparation` objects are deep-equal in every case

#### Scenario: Invalid compaction settings
- **WHEN** the session model's compaction override holds a negative `keepRecentTokens`
- **THEN** no draft is returned and one `[context-manager]` warning names `invalid_settings`

#### Scenario: Builder cancels
- **WHEN** the upstream builder returns `{ cancel: true }` for a boundary preparation
- **THEN** no draft is returned and the run continues

### Requirement: Summary and details stay upstream-compatible
The draft's `summary` and `details` SHALL be produced by the same builder that serves `session_before_compact`, from the branch, the cut and the previous compaction's summary and details chain, and SHALL use upstream pi-blackhole v0.5.15's `details` schema (`compactor: "blackhole"`, `om.folded`, the segment chain, `retainedToolOutputProjection`).

#### Scenario: Second compaction merges the first
- **WHEN** a session compacts twice through boundary drafts
- **THEN** the second summary is built with the first compaction's summary and details as its previous chain, as upstream's `compile()` does

#### Scenario: Upstream reads the fork's details
- **WHEN** upstream pi-blackhole v0.5.15 loads a session whose compaction entry the fork wrote, with the `context-manager.boundary` marker in `details`
- **THEN** upstream's details validator accepts the entry, and its `context` replay and `recall` work on it without error

### Requirement: Manual and overflow compaction use the same builder
pi's own threshold compaction, overflow recovery, `/compact` and `/context compact` SHALL produce their summary through the `session_before_compact` consumer, using `event.preparation`'s cut adjusted by `tailBehavior` and the shared builder. `/context compact` SHALL call the public `ctx.compact()` and SHALL report pi's refusal ("Nothing to compact", "Already compacted") as information.

#### Scenario: Manual compact
- **WHEN** the user runs `/compact` in an active session
- **THEN** the persisted compaction entry has `details.compactor` equal to `blackhole`

#### Scenario: Nothing to compact
- **WHEN** `/context compact` runs on a branch pi refuses to compact
- **THEN** the command prints an information line naming pi's reason and no error is shown

### Requirement: Work that follows a compaction runs after it is persisted
For a compaction the fork delivered through a boundary draft, the work upstream ran on `session_compact` for its own compactions (the display-only copy of the newest dropped assistant output, the success notice and the reset of its "compacted by blackhole" flag) SHALL run at the session's next `turn_start` or `agent_settled`, once, after the entry is persisted. Compactions pi announces SHALL keep upstream's `session_compact` handling.

#### Scenario: Pre-compaction output copy after a boundary compaction
- **WHEN** a boundary compaction drops the newest assistant text and `showPreCompactionMessage` is on
- **THEN** exactly one `blackhole-pre-compaction-output` entry is appended after the compaction entry

#### Scenario: Success notice after a boundary compaction
- **WHEN** a boundary compaction completes in a session with a UI
- **THEN** exactly one success notice is shown, after the entry is persisted

### Requirement: The fork uses no private pi internals
No module of the fork SHALL patch or read private members of pi classes, import from pi's `dist/` paths (public helpers come from the package root), or subscribe to events through untyped casts. The append-only `context` replay SHALL run as the context manager's `context` consumer.

#### Scenario: Static check
- **WHEN** the non-test sources outside `pi-vendor/` are scanned
- **THEN** none contains an `@earendil-works/pi-coding-agent/dist/` import, a `prepareCompaction` import from pi, `AgentSession`, `prototype.compact`, `_emit`, `_disconnectFromAgent`, or a `.settingsManager` member access
- **AND** the files under `pi-vendor/` import only symbols exported from the pi package root

#### Scenario: Context replay
- **WHEN** a session has an append-mode compaction chain and a request is built
- **THEN** the messages pi sends contain the projected segments exactly as upstream's `context` handler produces them
