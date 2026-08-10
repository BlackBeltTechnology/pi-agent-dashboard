## ADDED Requirements

### Requirement: Auto-attach locality gate

The server SHALL NOT auto-attach a session to a detected OpenSpec change, and SHALL NOT stamp `openspecChange`, unless that change is resolvable within the session's own project. Resolution consults the in-memory OpenSpec poll cache for a set of candidate roots and SHALL NOT trigger a fresh poll.

The candidate roots for a session are its `cwd` and, when present, its `gitWorktree.mainPath`. A change SHALL be treated as local when it appears in the cached change list of any candidate root.

Because worktree state is reported asynchronously by the bridge rather than at registration, the session SHALL carry an explicit `gitWorktreeReported` indicator, set whenever the bridge supplies worktree state at all — including when it reports that the session is **not** a worktree. The indicator SHALL NOT be inferred from the presence or absence of worktree information alone, because a session that is genuinely not a worktree and a session that has not yet reported are otherwise indistinguishable in session state. The indicator is server-internal and SHALL NOT be broadcast to clients.

A session SHALL be considered **worktree-resolved** when its `gitWorktreeReported` indicator is set, OR when it is known not to be a git repository. The second condition is required because a session whose directory is not a git repository never receives a worktree report at all, and would otherwise remain unresolved for its entire lifetime.

Candidate roots SHALL be composed from two independent rules:

- worktree main path, when present, SHALL always contribute a candidate root, regardless of whether the session is worktree-resolved;
- a session that is NOT worktree-resolved SHALL additionally contribute a root of unknown state, so that it is not rejected while its worktree state is still unknown.

This gate applies only to automatic inference. Manual attach paths (browser `attach_proposal` handler and `POST /api/session/:id/attach-proposal`) are unaffected and continue to accept any name from the server-curated list.

#### Scenario: Detected change absent from the session project is rejected

- **WHEN** a session with `cwd = "/repo-a"` produces an active detection for change `"c-b"`
- **AND** the poll cache for `/repo-a` is initialized and does not list `"c-b"`
- **AND** the session has no `gitWorktree.mainPath`
- **THEN** the server SHALL NOT set `attachedProposal`
- **AND** the server SHALL NOT set `openspecChange`
- **AND** the server SHALL NOT apply auto-rename

#### Scenario: Detected change present in the session cwd is accepted

- **WHEN** a session with `cwd = "/repo-a"` produces an active detection for change `"c-a"`
- **AND** the poll cache for `/repo-a` lists `"c-a"`
- **THEN** the auto-attach branch logic SHALL proceed unchanged

#### Scenario: Worktree session resolves against the main checkout

- **WHEN** a session with `cwd = "/repo-a/.worktrees/os-c-a"` and `gitWorktree.mainPath = "/repo-a"` produces an active detection for change `"c-a"`
- **AND** the poll cache for the worktree cwd is initialized and does NOT list `"c-a"`
- **AND** the poll cache for `/repo-a` lists `"c-a"`
- **THEN** the change SHALL be treated as local
- **AND** the auto-attach branch logic SHALL proceed unchanged

#### Scenario: Manual attach is not subject to the gate

- **WHEN** a user manually attaches change `"c-b"` to a session whose candidate roots do not list `"c-b"`
- **THEN** the attachment SHALL be applied

#### Scenario: Unreported worktree state does not cause rejection

- **WHEN** a session's worktree state has never been reported by the bridge
- **AND** its `cwd` cache is initialized and does not list the detected change
- **THEN** the gate SHALL allow the attach
- **AND** no rejection notice SHALL be emitted

#### Scenario: Reported non-worktree session is still gated on its cwd

- **WHEN** the bridge has reported that a session is not a worktree
- **AND** its `cwd` cache is initialized and does not list the detected change
- **THEN** the gate SHALL reject

#### Scenario: Reporting a non-worktree session sets the indicator

- **WHEN** the bridge reports worktree state for a session that is not a worktree
- **THEN** the session's `gitWorktreeReported` indicator SHALL be set
- **AND** the session SHALL thereafter be reject-capable on its `cwd` alone

#### Scenario: Non-git session is reject-capable without any worktree report

- **WHEN** a session is known not to be a git repository
- **AND** no worktree report has ever been received for it
- **AND** its `cwd` cache is initialized and does not list the detected change
- **THEN** the gate SHALL reject

#### Scenario: Restored worktree path contributes a root before any report

- **WHEN** a session's worktree main path is present from restored session metadata
- **AND** the session is not yet worktree-resolved
- **THEN** the main path SHALL contribute a candidate root
- **AND** an unknown root SHALL also be contributed

#### Scenario: Indicator is not broadcast

- **WHEN** the server updates a session's worktree state
- **THEN** the update broadcast to clients SHALL NOT include the `gitWorktreeReported` indicator

### Requirement: Locality gate treats an unpopulated cache as unknown

The locality gate SHALL distinguish a positive absence from an unpopulated cache. A candidate root whose cached data is missing or whose `initialized` flag is false SHALL be treated as unknown, not as absent. The gate SHALL reject only when every candidate root reports an initialized cache and none lists the detected change; when any candidate root is unknown, the gate SHALL allow.

#### Scenario: Uninitialized cache allows the attach

- **WHEN** an active detection for change `"c-a"` occurs for a session whose only candidate root has no cached OpenSpec data
- **THEN** the gate SHALL allow the attach
- **AND** no rejection notice SHALL be emitted

#### Scenario: Mixed known-absent and unknown roots allows the attach

- **WHEN** a session's `cwd` cache is initialized and does not list `"c-a"`
- **AND** the session's `gitWorktree.mainPath` cache is uninitialized
- **THEN** the gate SHALL allow the attach

#### Scenario: All roots initialized and absent rejects

- **WHEN** every candidate root for a session reports an initialized cache
- **AND** none of them lists the detected change
- **THEN** the gate SHALL reject

### Requirement: Locality rejection surfaces a deduplicated notice

When the locality gate rejects a detected change, the server SHALL emit one notification through the existing per-session notify channel, at level `info`, naming the rejected change and indicating it lies outside the session's folder.

The server SHALL emit at most one such notification per distinct `(sessionId, changeName)` pair for the lifetime of the session in memory, so that a repeated tool call cannot exhaust the bounded notify log.

Beyond appending to the notification log itself, the notification SHALL NOT alter session state: it SHALL NOT set `currentTool`, SHALL NOT mark the session unread, SHALL NOT reorder the session, and SHALL NOT contribute to any pending-ask or pending-prompt derivation.

The server SHALL suppress the notification when the rejected change name has previously been detected in the same session on evidence that appeared local — that is, from a change-creating CLI invocation, or from a path contained by a candidate root. Suppression SHALL be keyed on the change name, not on the pattern that produced the current detection, so that a write to a just-created change's own files does not produce a misleading notification.

Deduplication state SHALL be recorded only when a notification is actually emitted. A suppressed rejection SHALL NOT record it, so that a later genuine rejection of the same change name is still reported.

Both per-session records used by this requirement — the emitted-notification set and the locally-evidenced change-name set — SHALL be cleared when the session unregisters, so that neither retains state for a session that no longer exists.

#### Scenario: First rejection notifies

- **WHEN** the locality gate rejects change `"c-b"` for a session for the first time
- **AND** the detection did not originate from a change-creating CLI pattern
- **THEN** the server SHALL append one notify entry naming `"c-b"` at level `info`

#### Scenario: Creation-type detection rejects without notifying

- **WHEN** the locality gate rejects a change detected from an `openspec new change` command
- **THEN** the server SHALL NOT append a notify entry
- **AND** the rejection SHALL still take effect (no attach, no `openspecChange` stamp)

#### Scenario: Write to a just-created change does not notify

- **WHEN** a session creates change `"c-a"` via an `openspec new change` command that the gate rejects on a stale cache
- **AND** the session then writes to a path inside `"c-a"` that is contained by a candidate root
- **AND** the gate rejects that detection too
- **THEN** the server SHALL NOT append a notify entry for either detection

#### Scenario: In-cwd path evidence alone suppresses the notice

- **WHEN** the locality gate rejects change `"c-a"` detected from a path contained by a candidate root
- **THEN** the server SHALL NOT append a notify entry

#### Scenario: Suppressed rejection does not silence a later genuine notice

- **WHEN** a detection for change `"c-b"` is rejected and suppressed for lack of foreign evidence
- **AND** a later detection for `"c-b"` is rejected for the same session on evidence that did not appear local
- **THEN** the server SHALL append one notify entry naming `"c-b"`

#### Scenario: Repeated rejection of the same change does not re-notify

- **WHEN** the locality gate rejects change `"c-b"` for the same session a second time
- **THEN** the server SHALL NOT append a further notify entry

#### Scenario: Locally-evidenced state is cleared when the session unregisters

- **WHEN** a session that recorded locally-evidenced change names unregisters
- **THEN** the retained locally-evidenced state for that session SHALL NOT persist

#### Scenario: Dedupe state is cleared when the session unregisters

- **WHEN** a session that previously suppressed a repeat notice for `"c-b"` unregisters
- **AND** a session with the same identifier later registers and the gate rejects `"c-b"` again
- **THEN** the server SHALL append a notify entry
- **AND** the retained dedupe state for the unregistered session SHALL NOT persist

#### Scenario: Rejection of a different change notifies separately

- **WHEN** the locality gate rejects change `"c-b"` and later change `"c-c"` for the same session
- **THEN** the server SHALL append exactly one notify entry per distinct change name

#### Scenario: Notice does not make the session appear busy

- **WHEN** a locality rejection notice is emitted for an idle session
- **THEN** the session SHALL NOT gain a pending ask, a pending prompt request, or a `currentTool` value

### Requirement: Activity detector is scoped to a session cwd

The activity detector SHALL accept the session's `cwd` as a required parameter and SHALL NOT report a change name that provably belongs to another root.

A path-derived match SHALL be reported only when the matched path, resolved against the session `cwd` when relative, is contained by the session `cwd` using directory-boundary-correct matching, such that a sibling path sharing a leading string prefix is not treated as contained.

A command-derived match SHALL NOT be reported when the command relocates the working directory to a path outside the session `cwd` **anywhere** in the command string, whether that relocation appears before or after the OpenSpec invocation. The predicate is deliberately position-insensitive and applies uniformly to every command pattern the detector recognises, so that no pattern is governed by a different rule.

Because `cwd` is a required parameter, every call site SHALL be updated; the detector SHALL NOT provide a permissive default.

#### Scenario: Absolute change path inside the session cwd is detected

- **WHEN** a tool call references `/repo-a/openspec/changes/c-a/tasks.md`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL report `changeName: "c-a"`

#### Scenario: Absolute change path in another root is not detected

- **WHEN** a tool call references `/repo-b/openspec/changes/c-b/tasks.md`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT report a change name

#### Scenario: Sibling prefix path is not detected

- **WHEN** a tool call references `/repo-a-other/openspec/changes/c-b/tasks.md`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT report a change name

#### Scenario: Relative change path is resolved against the session cwd

- **WHEN** a tool call references `openspec/changes/c-a/tasks.md`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL report `changeName: "c-a"`

#### Scenario: Outside relocation suppresses archive and flag patterns too

- **WHEN** a bash tool call contains `cd /repo-b && openspec archive c-b`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT report a change name

#### Scenario: Outside relocation after the invocation suppresses flag patterns too

- **WHEN** a bash tool call contains `openspec validate --change c-b && cd /repo-b`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT report a change name

## MODIFIED Requirements

### Requirement: Server-side auto-attach from activity detection

When the server receives `openspec_activity_update` messages, it SHALL
update the session's `openspecPhase` and `openspecChange` fields
independently, subject to the locality gate: a detected `changeName` that
the gate rejects SHALL NOT be written to `openspecChange` and SHALL NOT
enter the branch logic below. After each permitted update, the server
SHALL apply the following branch logic when `openspecChange` is set and
the detected activity has `isActive: true`:

1. **No attachment** (`attachedProposal` is null/undefined): set
   `attachedProposal = openspecChange` (auto-attach).
2. **Auto-tracked attachment** (the witness rule
   `isNameAutoSetFromAttachment` returns true) AND a different
   `changeName`: set `attachedProposal = openspecChange` and apply
   auto-rename (silent re-attach, mirrors prior behaviour).
3. **Manual attachment, attached proposal still exists**, and
   `changeName !== attachedProposal` and
   `changeName !== pendingReplaceProposal` and `changeName ∉
   rejectedReplaceProposals`: set
   `pendingReplaceProposal = changeName` (surface the conflict via
   the dialog).
4. **Manual attachment, attached proposal no longer exists in the poll
   cache of any candidate root**: treat as case 1 (auto-attach the new
   `changeName`). Existence for this branch SHALL be resolved over the
   same candidate roots as the locality gate (session `cwd` plus
   worktree main path), and SHALL retain its permissive disposition on
   an unknown cache — an unknown root means the attachment is treated as
   still existing.

Read-only operations (`isActive: false`) SHALL update tracking fields
but SHALL NOT trigger any of the above branches. Read-only operations
remain subject to the locality gate for the `openspecChange` stamp.

#### Scenario: Branch 1 — auto-attach on first active event

- **WHEN** `attachedProposal = null` AND active event for `"B"`
- **AND** the locality gate permits `"B"`
- **THEN** server sets `attachedProposal = "B"`

#### Scenario: Branch 2 — silent re-attach on auto-tracked

- **WHEN** `attachedProposal = "A"` AND `name === "A"` (auto-tracked) AND active event for `"B"`
- **AND** the locality gate permits `"B"`
- **THEN** server sets `attachedProposal = "B"` and applies auto-rename

#### Scenario: Branch 3 — manual attachment surfaces dialog

- **WHEN** `attachedProposal = "A"` (manual, name differs) AND active event for `"B"`
- **AND** the locality gate permits `"B"`
- **AND** `"B" !== pendingReplaceProposal` AND `"B" ∉ rejectedReplaceProposals`
- **THEN** server sets `pendingReplaceProposal = "B"`
- **AND** `attachedProposal` remains `"A"`

#### Scenario: Branch 4 — manual attachment to deleted proposal

- **WHEN** `attachedProposal = "A"` AND `"A"` is not in the OpenSpec poll cache of any candidate root
- **AND** active event for `"B"`
- **AND** the locality gate permits `"B"`
- **THEN** server sets `attachedProposal = "B"` directly (no dialog)

#### Scenario: Branch 4 — worktree attachment to a main-only change is not treated as deleted

- **WHEN** a session with `cwd = "/repo-a/.worktrees/os-c-a"` and `gitWorktree.mainPath = "/repo-a"` is manually attached to `"c-a"`
- **AND** the worktree cwd cache is initialized and does not list `"c-a"`
- **AND** the cache for `/repo-a` lists `"c-a"`
- **AND** an active event detects a different change `"c-b"`
- **THEN** the attachment SHALL NOT be treated as deleted
- **AND** the server SHALL NOT silently re-attach to `"c-b"`
- **AND** branch 3 SHALL apply instead, setting `pendingReplaceProposal = "c-b"`

#### Scenario: Locality gate short-circuits the branch logic

- **WHEN** an active event detects `"B"` AND the locality gate rejects `"B"`
- **THEN** `openspecChange` SHALL remain unchanged
- **AND** none of branches 1-4 SHALL execute
- **AND** `pendingReplaceProposal` SHALL remain unchanged

### Requirement: Detect change name from openspec new change command

The activity detector SHALL detect the change name from `openspec new change "name"` commands using positional arguments, not just the `--change` flag pattern. Detection SHALL be suppressed when the command relocates the working directory to a path outside the session `cwd` anywhere in the command string, regardless of whether the relocation appears before or after the OpenSpec invocation.

#### Scenario: openspec new change with quoted name
- **WHEN** a bash tool call contains `openspec new change "add-auth"`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`

#### Scenario: openspec new change with unquoted name
- **WHEN** a bash tool call contains `openspec new change add-auth`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`

#### Scenario: command that changes directory outside the session cwd is not detected

- **WHEN** a bash tool call contains `cd /repo-b && openspec new change add-auth`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT return a change name

#### Scenario: outside relocation after the invocation is also suppressed

- **WHEN** a bash tool call contains `openspec new change add-auth && cd /repo-b`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL NOT return a change name

#### Scenario: command that changes directory within the session cwd is detected

- **WHEN** a bash tool call contains `cd /repo-a/packages/server && openspec new change add-auth`
- **AND** the session `cwd` is `/repo-a`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`
