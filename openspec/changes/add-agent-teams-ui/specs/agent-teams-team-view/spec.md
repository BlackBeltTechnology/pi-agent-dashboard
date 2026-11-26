## ADDED Requirements

### Requirement: Team view is a session-keyed content route

The plugin SHALL register one lazy `shell-overlay-route` claim with `presentation: "content"`, path `/session/:sessionId/team`, `sessionParam: "sessionId"`, `depth: 2` and `parentPath: "/session/:sessionId"`. It SHALL provide a visible Back control and SHALL NOT depend on Escape to leave.

#### Scenario: Sidebar stays usable
- **WHEN** the user opens the Team view on desktop
- **THEN** it renders beside the sidebar and teammate session cards remain clickable

#### Scenario: Mobile back
- **WHEN** the user presses Back on mobile
- **THEN** the shell returns to the session at `/session/:sessionId`

### Requirement: Any member session resolves the same team

The view SHALL resolve the team through `GET /api/plugins/agent-teams/teams?sessionId=<id>` for the route's session. A lead session and each of its teammate sessions SHALL show the same team; from a teammate session the header SHALL state which member is being viewed from.

#### Scenario: Open from a teammate
- **WHEN** the route is opened with a teammate's session id
- **THEN** the lead's team renders and the header names that teammate

#### Scenario: Session without a team
- **WHEN** the session belongs to no visible team
- **THEN** an empty state explains it and offers a link back to the session

### Requirement: Members grid shows status, model and current task

The view SHALL list every member with name, role, status as shape glyph plus text plus severity (one table in `status-map.ts`), model, current task (`#id title` of its lowest-id `in_progress` task, plus "+N more" when several), working directory relative to the lead cwd when inside it, a text notice when `degraded` is set, and an "Open session" link while the session exists.

#### Scenario: Busy member
- **WHEN** member `alice` is `busy` and owns in-progress task 3
- **THEN** her card shows the working state with text, her model and `#3` with its title

#### Scenario: Several in-progress tasks
- **WHEN** a member owns in-progress tasks 3 and 5
- **THEN** the card shows `#3` with its title and "+1 more", which opens the board filtered to that member

#### Scenario: Removed session
- **WHEN** a member is `gone` and its session no longer exists
- **THEN** the card shows plain text "session removed" instead of a link

#### Scenario: Degraded member
- **WHEN** a member has `degraded` `guard_unavailable`
- **THEN** its card shows a text notice naming the condition

### Requirement: Task board is read-only with owners and dependencies

The view SHALL show tasks in Pending, In progress and Completed sections with counts. Each task SHALL show id, title, owner, dependency chips with the dependency's current status ("missing" for a dependency that does not exist), a text "blocked" marker when the server marks it blocked, and its description and result in a disclosure. The board SHALL have no drag-and-drop and no edit controls.

#### Scenario: Blocked task
- **WHEN** task 4 is blocked by pending task 2
- **THEN** its card shows a text blocked marker and a chip "waits for #2 — pending"

#### Scenario: Dangling dependency
- **WHEN** task 4 depends on `#9`, which does not exist
- **THEN** its chip reads "waits for #9 — missing" and the blocked marker still follows the server flag

#### Scenario: Completed task result
- **WHEN** a completed task has a result and the user opens its disclosure
- **THEN** the description and the result show as plain text

### Requirement: Message log shows who said what

The view SHALL list the snapshot's mail oldest first with sender, recipient, kind label, time, bounded text with a per-row disclosure, an "urgent" marker when `priority` is `urgent` and a "not yet acknowledged" marker when `ackedAt` is absent. It SHALL offer filtering by member and urgent-only.

#### Scenario: Queued mail
- **WHEN** a mail to a disconnected member has no `ackedAt`
- **THEN** its row shows the text "not yet acknowledged"

#### Scenario: Filter by member
- **WHEN** the user filters by `bob`
- **THEN** only mail sent by, to or broadcast to `bob` is listed, and rows with equal timestamps keep the snapshot order

#### Scenario: Urgent only
- **WHEN** the user enables urgent-only
- **THEN** only mail with `priority` `urgent` is listed, each with the text marker

### Requirement: Header reflects team lifecycle honestly

The header SHALL show the team name, status (starting, active, orphaned, closing, closed), member and task counts, a notice for an orphaned team, a warning when the snapshot reports `persist_degraded`, a closing indicator with controls disabled, and SHALL hide all controls for a closed team (read-only).

#### Scenario: Orphaned team
- **WHEN** the lead session has ended and the team is `orphaned`
- **THEN** the header says in static text that the lead ended and teammates continue until the orphan time limit elapses, with no countdown or deadline

#### Scenario: Closed team
- **WHEN** the team is `closed`
- **THEN** the snapshot renders read-only with no Stop or Shut down controls

#### Scenario: Persistence degraded
- **WHEN** the snapshot reports `persist_degraded`
- **THEN** the header shows a warning that changes may not survive a restart

### Requirement: User controls in this change are Stop member and Shut down team

When the snapshot has `viewerCanControl`, a `busy` member card SHALL offer Stop, and a starting, active or orphaned team SHALL offer Shut down team behind a confirmation dialog that states the lead session stays open. This change SHALL NOT add approvals, task edits, spawning, team creation or messaging; the Start team entry and plan approval belong to change 3 and live outside the Team view (a sidebar claim and chat cards).

#### Scenario: Stop a busy member
- **WHEN** the user activates Stop on a busy member
- **THEN** the stop route is called once and the card shows the new state after the next refresh

#### Scenario: Confirm shutdown
- **WHEN** the user activates Shut down team
- **THEN** a labelled confirmation dialog appears and the route is called only after confirmation

#### Scenario: Stop needs no confirmation
- **WHEN** the user activates Stop on a busy member
- **THEN** no confirmation dialog is shown and the stop route is called once

#### Scenario: Viewer without control
- **WHEN** `viewerCanControl` is false
- **THEN** no Stop or Shut down control is rendered

#### Scenario: Refused by the tier gate
- **WHEN** a control call answers 403 although `viewerCanControl` was true
- **THEN** the view shows an inline permission message and no error toast storm

### Requirement: Message log states its scope and tolerates unknown kinds

The log SHALL show "Showing last N messages" when core's snapshot field `mailTotal` exceeds the listed mail (static "recent messages" when the field is absent) and SHALL render a mail kind it does not know, such as `lock_grant`, as a generic row with the kind label, sender, recipient and plain text. All team mail, including peer-to-peer mail, SHALL be shown to anyone allowed to view the team.

#### Scenario: Tail indicator
- **WHEN** the snapshot lists 100 mails and `mailTotal` is 5000
- **THEN** the log says it shows the last 100 messages

#### Scenario: Unknown kind
- **WHEN** a mail has kind `lock_grant`
- **THEN** the row shows the kind label and text in the generic layout and does not throw

#### Scenario: Peer mail
- **WHEN** a mail is sent from `alice` to `bob`
- **THEN** the owner sees it in the log

### Requirement: No team and not found are distinct without an existence oracle

A lookup that returns no team SHALL render the no-team state, which never reveals whether a hidden team exists. The not-found state SHALL render only when a team that was resolved earlier later answers 404.

#### Scenario: Hidden team
- **WHEN** the lookup for a session returns an empty list
- **THEN** the no-team state shows, identical to a session that never had a team

#### Scenario: Team vanishes
- **WHEN** a resolved team answers 404 on refetch
- **THEN** the cache is dropped and the not-found state shows

### Requirement: Control calls resolve unknown outcomes visibly

A Stop or Shut down request that gets no answer within 15 seconds SHALL show "no response — checking state", refetch the snapshot, re-enable the button and never retry automatically. At most one POST SHALL be in flight per control.

#### Scenario: Stalled control
- **WHEN** the stop POST gets no answer for 15 s
- **THEN** the card shows "no response — checking state", the snapshot is refetched and the button is enabled again without a second POST

### Requirement: View state survives refreshes and exposes a test-id contract

Open disclosures, filters, scroll position and focus SHALL be keyed by stable ids and survive snapshot refreshes: a moved task keeps its disclosure, a filter on a vanished member resets to "all" with an inline note, and the log follows the newest mail only when within 8 px of the end. Member cards and the header SHALL expose `data-testid` `team-member-open-subagent`, `team-member-status` (with `data-status`), `team-header-mode` and `team-header-parallel`.

#### Scenario: Task moves
- **WHEN** an open task moves from Pending to In progress during a refresh
- **THEN** its disclosure stays open and focus is not lost to the document body

#### Scenario: Reading history
- **WHEN** the user has scrolled up and a new mail arrives
- **THEN** the view does not jump and a "New messages" control appears

### Requirement: Layout adapts and stays reachable

The sections SHALL be a tablist (Members, Tasks, Messages) on every viewport width (owner decision of the mock loop, tabs-everywhere), with roving tabindex and arrow, Home and End keys; exactly one panel is visible at a time and the selected tab SHALL survive a resize. The route SHALL bound its height with an inner scroller and SHALL NOT occlude any interactive element with its close or back control.

#### Scenario: Keyboard tabs
- **WHEN** focus is on the Tasks tab on a narrow viewport and the user presses ArrowRight
- **THEN** focus and selection move to Messages and its panel shows

#### Scenario: Overflowing board
- **WHEN** 50 tasks overflow the container height
- **THEN** a descendant scroller makes all of them reachable

### Requirement: Accessibility and theming meet the UI contract

The view SHALL meet `ui-contract.md` accessibility invariants: contrast of at least 3:1 (the repo floor) for every token used, in both themes, with 4.5:1 advisory, visible focus on every control, primary actions at least 44 px below `sm`, state never conveyed by color alone, colors only from theme tokens, `prefers-reduced-motion` honoured, and one polite live region announcing coalesced status changes at most once per 4 seconds without message text.

#### Scenario: Status without color
- **WHEN** a member status changes from idle to failed
- **THEN** the card changes shape glyph and text as well as color

#### Scenario: Throttled announcements
- **WHEN** ten changes arrive within two seconds
- **THEN** at most one polite announcement is made and it contains no message text

### Requirement: Every state renders something

The view SHALL render a loading skeleton with `aria-busy`, a no-team state, a not-found state for inaccessible teams, an error state with retry that keeps the last snapshot, and empty states for no members, no tasks and no messages. It SHALL never render a blank panel.

#### Scenario: Fetch fails after first load
- **WHEN** a refresh fails while a snapshot is cached
- **THEN** the cached snapshot stays visible with a stale notice and a retry control
