## Purpose

Enables per-directory session ordering with persistence, auto-placement rules, and drag-and-drop reordering via the browser client.
## Requirements
### Requirement: Persist session order per directory
The server SHALL maintain an ordered list of session IDs per cwd. The order SHALL be persisted in the state JSON file under a `sessionOrder` key mapping cwd strings to session ID arrays.

#### Scenario: Order persists across server restarts
- **WHEN** session order is set for a cwd and the server restarts
- **THEN** the order SHALL be restored from the state JSON file

#### Scenario: Empty order for unknown cwd
- **WHEN** no order has been set for a cwd
- **THEN** `getOrder(cwd)` SHALL return an empty array

### Requirement: Auto-place new sessions at the beginning
When a new session registers, the server SHALL prepend its ID to the front of the order array for its **resolved group path** (see "Order map keyed by resolved group path"). The session surfaces at the top of the active tier.

#### Scenario: New session prepended
- **WHEN** a session registers whose resolved key is `/project` and the current order is `["s1", "s2"]`
- **THEN** the order SHALL become `["s3", "s1", "s2"]`

#### Scenario: First session in a key
- **WHEN** a session registers with a resolved key that has no existing order
- **THEN** the order SHALL be `["s1"]`

### Requirement: Auto-place forked sessions after parent
When a fork is initiated, the server SHALL record a pending fork entry with the parent session ID and cwd. When the new session registers in that cwd, it SHALL be inserted immediately after the parent session in the order array.

#### Scenario: Fork inserts after parent
- **WHEN** session "s2" is forked from session "s1" in cwd `/project` with order `["s1", "s3"]`
- **THEN** the order SHALL become `["s1", "s2", "s3"]`

#### Scenario: Fork pending entry expires
- **WHEN** a fork is initiated but no new session registers within 30 seconds
- **THEN** the pending fork entry SHALL be discarded
- **AND** if the session registers later, it SHALL be prepended as a normal new session

#### Scenario: Fork parent not in order array
- **WHEN** a fork's parent session ID is not found in the order array
- **THEN** the forked session SHALL be prepended (fallback to new session behavior)

### Requirement: Continued sessions keep position
When a session is resumed with `mode: "continue"`, the server SHALL choose its placement in the cwd's order array based on a **4-way intent contract** combining the `pendingResumeIntents` registry and the `registerReason` field on the `session_register` message:

- **`registerReason: "reattach"`** — bridge auto-reattach after a dashboard restart. Server SHALL apply the configured `reattachPlacement` policy (see "Reattach placement policy applied on register").
- **`"front"`** (registry intent) — move the session id to index 0 of `sessionOrder` regardless of its prior position. Tagged by: Resume button click, REST resume endpoint, and prompt-auto-resume to an ended session (the user is actively interacting). Server SHALL broadcast `sessions_reordered` with the new order.
- **`"keep"`** (registry intent) — leave `sessionOrder` unchanged. The drop position written by an earlier `reorder_sessions` message is the source of truth and MUST NOT be clobbered. Tagged by: drag-to-resume only. Server SHALL NOT broadcast `sessions_reordered` for the transition itself (the drag's `reorder_sessions` already broadcast).
- **No tag and no `registerReason`** — backwards-compatible legacy bridges. Server SHALL preserve the existing layout (no mutation, no broadcast). Equivalent to the old `null` intent.

The `registerReason: "reattach"` signal takes precedence over a `null` registry intent. If both a registry intent (`"front"` or `"keep"`) and `registerReason: "reattach"` are present (e.g. a user clicked Resume mid-flight on a reconnecting session), the registry intent wins because it represents an explicit user action.

Any code path that initiates a user-driven resume MUST call `pendingResumeIntents.record(sessionId, intent)` before triggering the spawn. The `consume(sessionId)` call in the `onChange` ended→alive branch returns `"front" | "keep" | null`.

#### Scenario: Resume button moves id to front
- **WHEN** session "s2" is at position 1 in order `["s0", "s1", "s2"]` and the user clicks the Resume button on "s2"
- **THEN** the registry SHALL be tagged with `intent: "front"` for "s2"
- **AND** after the bridge re-registers, the order SHALL become `["s2", "s0", "s1"]`
- **AND** the server SHALL broadcast `sessions_reordered` with the new order

#### Scenario: REST resume moves id to front
- **WHEN** the browser sends `POST /api/session/s2/resume` against an ended session "s2"
- **THEN** the registry SHALL be tagged with `intent: "front"` for "s2"
- **AND** after the bridge re-registers, the order SHALL move "s2" to index 0
- **AND** the server SHALL broadcast `sessions_reordered`

#### Scenario: Drag-to-resume preserves dropped slot
- **WHEN** the user drags ended session "X" from the ended bucket and drops it between alive sessions "A" and "B" in the same folder
- **THEN** the client SHALL first send `reorder_sessions` with `["A", "X", "B"]`
- **AND** the server SHALL persist that order and broadcast `sessions_reordered`
- **AND** the client SHALL then send `resume_session { sessionId: "X", placement: "keep" }`
- **AND** the server SHALL tag the registry with `intent: "keep"` for "X"
- **AND** when the bridge re-registers "X" and the ended→alive transition fires, the server SHALL NOT mutate `sessionOrder`
- **AND** the order SHALL remain `["A", "X", "B"]` (dropped slot preserved)
- **AND** the server SHALL NOT broadcast `sessions_reordered` for the ended→alive transition

#### Scenario: Resume cycle keeps front placement on each cycle
- **WHEN** session "s1" goes through end → resume-via-button → end → resume-via-button in cwd `/project`
- **THEN** after each user-intent resume tagged `"front"`, the id "s1" SHALL be at index 0 of `sessionOrder`
- **AND** repeated cycles SHALL not cause "s1" to drift to a non-front position

#### Scenario: Bridge auto-reattach with registerReason applies configured policy
- **WHEN** the dashboard server restarts and a still-alive bridge re-registers session "s2" with `registerReason: "reattach"`
- **THEN** the server SHALL apply the configured `reattachPlacement` policy (default `"always"` → `moveToFront(cwd, "s2")` + broadcast `sessions_reordered`)

#### Scenario: Legacy bridge reattach without registerReason preserves layout
- **WHEN** the dashboard server restarts and a legacy bridge (no `registerReason` field) re-registers session "s2"
- **THEN** the server SHALL treat the absence as `registerReason: "spawn"` and apply the existing prepend-or-no-op rule for the session id
- **AND** the server SHALL NOT apply the reattach placement policy

#### Scenario: Re-record overwrites prior intent (last-write-wins)
- **WHEN** the registry is tagged with `intent: "keep"` for session "X" (from a drag-to-resume), then the user clicks Resume on "X" before the bridge re-registers, tagging with `intent: "front"`
- **THEN** the second `record` call SHALL overwrite the first
- **AND** when the bridge re-registers "X", `consume("X")` SHALL return `"front"`
- **AND** the server SHALL move "X" to the front of `sessionOrder`

#### Scenario: Registry intent wins over reattach
- **WHEN** the registry is tagged with `intent: "front"` for session "X" AND the bridge re-registers "X" with `registerReason: "reattach"`
- **THEN** the server SHALL apply the registry intent (move-to-front + broadcast)
- **AND** the reattach policy SHALL be ignored for this register

#### Scenario: Expired intent treated as bridge reattach
- **WHEN** the registry was tagged for session "X" more than 60 seconds ago and the bridge re-registers "X" only now
- **THEN** `consume("X")` SHALL return `null` (lazy expiry)
- **AND** if `registerReason: "reattach"` is present, the reattach policy applies; otherwise the server SHALL NOT mutate `sessionOrder`

### Requirement: Reattach placement policy applied on register
When the server receives a `session_register` message with `registerReason: "reattach"` AND no overriding registry intent (`"front"` or `"keep"`), it SHALL apply the placement policy configured by the `reattachPlacement` field of `~/.pi/dashboard/config.json`:

- **`"always"`** (default) — call `sessionOrderManager.moveToFront(cwd, sessionId)` and broadcast `sessions_reordered`. Apply unconditionally regardless of session status.
- **`"streaming-only"`** — call `moveToFront` and broadcast only when the session's **prior status** (the value captured by `memory-session-manager.ts::register` BEFORE coercing `status` to `"active"`) is `"streaming"`. The prior value is forwarded to the policy via `OnChangeContext.priorStatus`; when it is unknown (first-ever register), the helper falls back to the current `session.status`. For all other prior statuses (`"active"`, `"idle"`, `"ended"`), leave order unchanged and do not broadcast.
- **`"preserve"`** — leave `sessionOrder` unchanged and do not broadcast. Equivalent to the legacy `null`-intent reattach behavior.

Application of the policy SHALL happen in the `event-wiring.ts onSessionRegistered` hook, after any pending attach-proposal intent has been consumed.

#### Scenario: Always policy moves reattached session to front regardless of status
- **WHEN** `reattachPlacement` is `"always"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"active"` (idle)
- **THEN** the server SHALL call `moveToFront(cwd, "s5")` and broadcast `sessions_reordered`

#### Scenario: Streaming-only policy moves only streaming sessions
- **WHEN** `reattachPlacement` is `"streaming-only"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"streaming"`
- **THEN** the server SHALL call `moveToFront(cwd, "s5")` and broadcast `sessions_reordered`

#### Scenario: Streaming-only policy ignores non-streaming reattach
- **WHEN** `reattachPlacement` is `"streaming-only"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"active"` (or `"idle"`)
- **THEN** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast

#### Scenario: Preserve policy never moves on reattach
- **WHEN** `reattachPlacement` is `"preserve"` and the bridge re-registers session "s5" with `registerReason: "reattach"` (any status)
- **THEN** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast

#### Scenario: Default policy is always
- **WHEN** `~/.pi/dashboard/config.json` does not include `reattachPlacement` and the bridge re-registers a session with `registerReason: "reattach"`
- **THEN** the server SHALL behave as if `reattachPlacement: "always"` was configured

### Requirement: resume_session message carries placement intent
The `resume_session` browser-to-server message SHALL accept an optional `placement` field of type `"front" | "keep"`. When omitted, the server SHALL default to `"front"`.

The server SHALL tag `pendingResumeIntents` with the resolved value before initiating the spawn so the `onChange` ended→alive branch consumes the correct intent.

#### Scenario: resume_session without placement defaults to front
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue" }` without a `placement` field
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "front")`
- **AND** the resulting ended→alive transition SHALL move "s1" to the front of `sessionOrder`

#### Scenario: resume_session with placement: keep is honored
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue", placement: "keep" }`
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "keep")`
- **AND** the resulting ended→alive transition SHALL NOT mutate `sessionOrder`

#### Scenario: resume_session with placement: front explicitly
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue", placement: "front" }`
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "front")` (identical to the default)

#### Scenario: Fork mode ignores placement field
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "fork", placement: "keep" }`
- **THEN** the fork SHALL create a new session id (different from "s1") and `placement` SHALL be ignored for the new id
- **AND** any new id placement is governed by the existing fork-after-parent rule, not by this contract

### Requirement: Drag-and-drop reorder via browser
The browser SHALL be able to send a `reorder_sessions` message with the full ordered session ID array for a cwd. The server SHALL replace the stored order with the provided array.

#### Scenario: Reorder via drag-and-drop
- **WHEN** the browser sends `reorder_sessions` with cwd `/project` and sessionIds `["s2", "s1", "s3"]`
- **THEN** the server SHALL store the order as `["s2", "s1", "s3"]` and broadcast `sessions_reordered` to all browsers

### Requirement: Broadcast order changes
The server SHALL broadcast a `sessions_reordered` message to all connected browsers whenever the order for a cwd changes (insert, reorder, or removal).

#### Scenario: Order broadcast on new session
- **WHEN** a new session is prepended to a cwd's order
- **THEN** the server SHALL broadcast `sessions_reordered` with the updated order

#### Scenario: Order broadcast on drag-and-drop
- **WHEN** the browser sends `reorder_sessions`
- **THEN** the server SHALL broadcast `sessions_reordered` to all connected browsers

### Requirement: Prune stale session IDs from order
When returning the order for a cwd, the server SHALL filter out session IDs that no longer exist in the session manager.

#### Scenario: Stale ID pruned
- **WHEN** the order contains `["s1", "s2", "s3"]` but "s2" no longer exists in the session manager
- **THEN** `getOrder(cwd)` SHALL return `["s1", "s3"]`

### Requirement: Client renders sessions in server order
The client SHALL render session cards within a folder group by the stored order, partitioned into ACTIVE/ENDED/HIDDEN tiers (see "Client renders folders by stable status-partition of the stored order"). Within each tier the stored relative order is preserved; ids absent from the stored order are appended to their tier sorted by `startedAt` descending. The flat order alone determines order within a folder — there SHALL be no workspace-cluster adjacency constraint layered on top.

#### Scenario: Sessions rendered in order within a tier
- **WHEN** the stored order for a folder is `["s2", "s1"]` and both are active
- **THEN** session "s2" SHALL appear before session "s1" in the active tier

#### Scenario: Unordered active sessions appended by recency
- **WHEN** the stored order is `["s1"]` but the active set also contains "s2" and "s3"
- **THEN** "s1" SHALL appear first, followed by "s2" and "s3" sorted by `startedAt` descending

#### Scenario: No worktree clustering in the ordering path
- **WHEN** a folder contains a main-checkout session and worktree sessions, and a worktree session is moved to front
- **THEN** that worktree session SHALL render at the top of its tier ahead of the main-checkout session — no forced cluster adjacency reorders it back

### Requirement: Client drag-and-drop interaction
The client SHALL allow users to drag session cards within a folder group to reorder them. On drop, the client SHALL send a `reorder_sessions` message with the new order. The client SHALL use a single `DndContext` for both session card and pinned directory group drag-and-drop, using the `data` property on sortable items to discriminate item types.

#### Scenario: Drag session card in unpinned group
- **WHEN** the user drags session "s2" above session "s1" in an unpinned folder group
- **THEN** the client SHALL send `reorder_sessions` with the updated order array
- **AND** optimistically reorder the cards before server confirmation

#### Scenario: Drag session card in pinned group
- **WHEN** the user drags session "s2" above session "s1" in a pinned folder group
- **THEN** the client SHALL send `reorder_sessions` with the updated order array
- **AND** optimistically reorder the cards before server confirmation

#### Scenario: Drag pinned group does not affect session order
- **WHEN** the user drags a pinned directory group to a new position
- **THEN** the client SHALL reorder pinned directories
- **AND** session order within each group SHALL remain unchanged

#### Scenario: Cross-type drag is ignored
- **WHEN** a session card is dragged over a pinned directory group droppable (or vice versa)
- **THEN** the client SHALL not perform any reorder

### Requirement: Order map keyed by resolved group path
The server SHALL key every order-map mutation (`insert`, `moveToFront`, `remove`, `reorder`) by the session's **resolved group path**, computed identically to the client grouping resolver: the first non-empty of an explicit pin match on the session's `cwd`, `session.jjState.workspaceRoot`, `session.gitWorktree.mainPath`, or `session.cwd`. The persisted `sessionOrder` key SHALL be this resolved path, not the raw session `cwd`.

This guarantees worktree/jj sessions — which the client groups under their parent repo — share one order list under that parent, so `insert`/`moveToFront`/`remove` write to the same key the client reads.

#### Scenario: Worktree session keyed under parent repo
- **WHEN** a session registers with `cwd = "/repo/.worktrees/feat-x"` and `gitWorktree.mainPath = "/repo"` and `/repo/.worktrees/feat-x` is not pinned
- **THEN** the server SHALL insert the id into `sessionOrder["/repo"]`, NOT `sessionOrder["/repo/.worktrees/feat-x"]`

#### Scenario: moveToFront on a worktree session takes effect in the UI
- **WHEN** a worktree session under parent `/repo` is moved to front (resume, completed, question, end, hide, or unhide)
- **THEN** the server SHALL `moveToFront("/repo", id)` and broadcast `sessions_reordered { cwd: "/repo", ... }`
- **AND** the client SHALL render the change (key matches the group the client reads)

#### Scenario: Explicit pin of worktree path keys under the pin
- **WHEN** the user has pinned `/repo/.worktrees/feat-x` AND that pin matches the session's `cwd`
- **THEN** the order key SHALL be `/repo/.worktrees/feat-x` (pin wins over worktree collapse)

#### Scenario: Plain checkout unaffected
- **WHEN** a session has no `jjState` and no `gitWorktree` and its `cwd` is not a pinned subpath
- **THEN** the resolved group path SHALL equal `cwd` and ordering behaves exactly as before

### Requirement: Order map holds all-status session ids
The persisted `sessionOrder` list for a key SHALL contain session ids of **all** statuses — active, ended, and hidden. The server SHALL NOT remove an id from the order list solely because the session transitioned to `ended` or was hidden. Ids SHALL be removed from the order only when the session no longer exists in the session manager (stale-id pruning).

#### Scenario: Ended id stays in the order
- **WHEN** alive session "s2" in order `["s1", "s2", "s3"]` transitions to `ended`
- **THEN** "s2" SHALL remain in `sessionOrder` (placement governed by the completed-first rule), and SHALL NOT be silently dropped

#### Scenario: Hidden id stays in the order
- **WHEN** session "s2" is hidden
- **THEN** "s2" SHALL remain in `sessionOrder` (placement governed by the hide rule)

### Requirement: Client renders folders by stable status-partition of the stored order
The client SHALL render each folder group by partitioning the stored order list into three tiers — ACTIVE (status ≠ `ended` and not hidden), ENDED (status `ended` and not hidden), HIDDEN — preserving each id's relative position within its tier. Rendering SHALL concatenate ACTIVE, then ENDED (behind the collapsed "Show N ended" control), then HIDDEN (behind the "N hidden" control). Ids present in the group but absent from the stored order SHALL be appended to their tier sorted by `startedAt` descending.

Because the partition is stable, a stored-order `moveToFront` SHALL surface a card at the top of whichever tier it belongs to.

#### Scenario: Active and ended derive from one list
- **WHEN** the stored order for a folder is `["E1", "A1", "A2", "E2"]` with E* ended and A* active
- **THEN** the ACTIVE tier SHALL render `A1, A2` and the ENDED tier SHALL render `E1, E2`

#### Scenario: moveToFront surfaces at top of own tier
- **WHEN** the stored order is `["A1", "A2", "E1", "E2"]` and "E2" is moved to front → `["E2", "A1", "A2", "E1"]`
- **THEN** the ACTIVE tier SHALL still render `A1, A2`
- **AND** the ENDED tier SHALL render `E2, E1` (E2 at top of the ended tier)

### Requirement: Status-transition placement gated by settings
On an alive→ended transition, and on alive in-session signals, the server SHALL apply move-to-front placement gated by two global config booleans:

- **`alive→ended`** — when `completedFirst` is true, the server SHALL `moveToFront(key, id)` and broadcast `sessions_reordered`; when false, it SHALL leave `sessionOrder` unchanged (the id keeps its slot; the client partition re-tiers it into ended).
- **alive `agent_end`** (turn completed, session still alive/idle) — when `completedFirst` is true, the server SHALL `moveToFront(key, id)` and broadcast; when false, no-op.
- **alive `ask_user` request** — when `questionFirst` is true, the server SHALL `moveToFront(key, id)` and broadcast; when false, no-op.

These triggers SHALL NOT override the resume-intent contract: a drag-to-resume `keep` intent or a registry `front` intent already consumed for the same transition takes precedence, and `reattachPlacement` policy applies before these gated triggers.

#### Scenario: Completed-first off keeps ended slot
- **WHEN** `completedFirst` is false and alive session "s2" in order `["s1", "s2", "s3"]` ends
- **THEN** `sessionOrder` SHALL remain `["s1", "s2", "s3"]`
- **AND** the client SHALL render "s2" in the ended tier at the relative position implied by that list

#### Scenario: Completed-first on surfaces ended at top of ended tier
- **WHEN** `completedFirst` is true and alive session "s2" ends in a folder with existing ended sessions
- **THEN** the server SHALL `moveToFront(key, "s2")` and broadcast
- **AND** the client SHALL render "s2" at the top of the ended tier

#### Scenario: Completed-first on surfaces a finished alive turn at top of active
- **WHEN** `completedFirst` is true and an alive session emits `agent_end` (turn done, still alive) while other active sessions exist
- **THEN** the server SHALL `moveToFront(key, id)` and broadcast
- **AND** the client SHALL render the session at the top of the active tier

#### Scenario: Question-first on surfaces an ask_user session at top of active
- **WHEN** `questionFirst` is true and an alive session issues an `ask_user` request
- **THEN** the server SHALL `moveToFront(key, id)` and broadcast
- **AND** the client SHALL render the session at the top of the active tier

#### Scenario: Question-first off keeps position on ask_user
- **WHEN** `questionFirst` is false and an alive session issues an `ask_user` request
- **THEN** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast

#### Scenario: ask_user move-to-front is idempotent
- **WHEN** `questionFirst` is true and a session at the front of the active tier issues repeated `ask_user` requests
- **THEN** each `moveToFront` SHALL be a no-op mutation (id already at front) and SHALL NOT reorder other cards

#### Scenario: Drag-to-resume keep wins over completed-first
- **WHEN** a session is drag-resumed (`keep` intent) and `completedFirst` is true
- **THEN** the dropped slot SHALL be preserved and the completed/ended auto-move SHALL NOT clobber it

### Requirement: Hide and unhide placement
When a session is **hidden**, the server SHALL `moveToFront(key, id)` so it surfaces at the top of the HIDDEN tier. When a session is **unhidden**, the server SHALL clear the hidden flag and `moveToFront(key, id)` so it surfaces at the top of the ENDED tier. Both SHALL broadcast `sessions_reordered`.

#### Scenario: Hide surfaces at top of hidden tier
- **WHEN** the user hides session "s2"
- **THEN** the server SHALL `moveToFront(key, "s2")` and broadcast
- **AND** the client SHALL render "s2" at the top of the hidden tier

#### Scenario: Unhide surfaces at top of ended tier
- **WHEN** the user unhides session "s2" (an ended, hidden session)
- **THEN** the server SHALL clear `hidden` and `moveToFront(key, "s2")` and broadcast
- **AND** the client SHALL render "s2" at the top of the ended tier

### Requirement: Completed-first and question-first config settings
`~/.pi/dashboard/config.json` SHALL accept two optional boolean fields, `completedFirst` and `questionFirst`, both defaulting to `false`. The Settings UI SHALL expose them as toggles. The server SHALL read them to gate the status-transition placement rules.

#### Scenario: Defaults are off
- **WHEN** the config omits `completedFirst` and `questionFirst`
- **THEN** both SHALL default to `false` (no auto-move on completed/ended or question)

#### Scenario: Toggle persists
- **WHEN** the user enables "Put completed session first" in Settings
- **THEN** `completedFirst: true` SHALL persist to `config.json` and gate subsequent transitions

### Requirement: Migration backfill of ended ids by endedAt
On startup, for each `sessionOrder` key, the server SHALL append any **ended** session ids that exist in the session manager under that resolved key but are **absent** from the stored list, ordered by `(endedAt ?? startedAt)` descending. The backfill SHALL be idempotent (ids already present are left in place) and SHALL replace the prior startup reconcile that stripped ended ids.

#### Scenario: Pre-migration ended ids seeded by recency
- **WHEN** a persisted map (alive-only, from before this change) is loaded and the manager has ended sessions "e1" (endedAt 9000) and "e2" (endedAt 8000) absent from the list
- **THEN** the server SHALL append `["e1", "e2"]` (most-recent first) so the ended tier renders identically to the previous `endedAt`-desc behaviour

#### Scenario: Backfill is idempotent
- **WHEN** the ended ids are already present in the stored order
- **THEN** the startup pass SHALL leave the order unchanged

### Requirement: Deferred order-key re-resolution when group identity arrives after register
The server SHALL re-key a session's order entry to its resolved group key when group identity arrives after register.

A worktree (or jj) session's group identity — `gitWorktree.mainPath` /
`jjState.workspaceRoot` — is NOT present on the initial `session_register`; the
bridge sends it shortly after via `git_info_update`. Because
`resolveOrderKey` depends on that identity, a fresh worktree session is first
inserted under its own raw `cwd` key, NOT the parent key the client groups under.

When a later update first establishes (or changes) a session's group identity
such that `resolveOrderKey(session)` resolves to a DIFFERENT key than the one
the session's id currently lives under, the server SHALL re-key the order entry:
remove the id from the stale key (pruning the entry if its list becomes empty),
prepend the id to the FRONT of the resolved key's order list, and broadcast a
single `sessions_reordered { cwd: <resolvedKey>, sessionIds }` (with ids filtered
to sessions whose resolved key equals the resolved key). When the resolved key
equals the current key, the server SHALL make NO mutation and NO broadcast.

Front placement is used because the session is brand-new at this point, matching
the "Auto-place new sessions at the beginning" intent. This makes a freshly
spawned worktree session occupy the top slot of its parent group (the slot its
spawn placeholder held), instead of falling into the unordered bucket and
rendering at the bottom.

#### Scenario: Worktree session re-keyed to parent front when gitWorktree arrives
- **WHEN** a session registers with `cwd = /repo/.worktrees/feat-x` and `gitWorktree` undefined, and is inserted into `sessionOrder["/repo/.worktrees/feat-x"]`
- **AND** a subsequent `git_info_update` sets `gitWorktree.mainPath = /repo` (and `/repo/.worktrees/feat-x` is not pinned)
- **THEN** the id SHALL be removed from `sessionOrder["/repo/.worktrees/feat-x"]` (entry pruned if now empty)
- **AND** the id SHALL be prepended to the FRONT of `sessionOrder["/repo"]`
- **AND** the server SHALL broadcast exactly one `sessions_reordered { cwd: "/repo", ... }` for the transition

#### Scenario: No re-key when gitWorktree present on register
- **WHEN** a (legacy) bridge sends `gitWorktree.mainPath = /repo` on the initial `session_register` so the id is inserted under `/repo` immediately
- **AND** a later `git_info_update` re-asserts the same `gitWorktree`
- **THEN** `resolveOrderKey` equals the current key
- **AND** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast `sessions_reordered` for the transition

#### Scenario: Re-key is idempotent across repeated updates
- **WHEN** the id already lives under the resolved parent key and another `git_info_update` arrives
- **THEN** the server SHALL detect key equality and perform no mutation and no broadcast

#### Scenario: Stale worktree-cwd key pruned
- **WHEN** the only id under `sessionOrder["/repo/.worktrees/feat-x"]` is re-keyed to `/repo`
- **THEN** the empty `sessionOrder["/repo/.worktrees/feat-x"]` entry SHALL be pruned
- **AND** no session SHALL group under that stale key
