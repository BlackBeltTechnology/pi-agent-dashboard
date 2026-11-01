# Session Card Subcards

## Purpose

Group desktop session card sections into translucent inset panels (subcards) with capsule legend titles. Each subcard wraps a related cluster of controls (OPENSPEC / WORKSPACE / PROCESS / MEMORY / FLOWS) and hides itself when empty. Mobile layout unchanged. Reserves plugin slots `session-card-memory` and `workspace-action-bar`, replaces the round status dot with a status-colored source icon, and turns the card's left gutter into the drag handle.

## Requirements

### Requirement: Subcard wrapper component renders translucent inset panel with capsule legend title
The desktop session card SHALL group related controls inside `SessionSubcard` wrappers. Each `SessionSubcard` SHALL render a border-only inset panel (no fill) with a small uppercase capsule (pill) legend overhanging the panel's top border (fieldset-legend style).

The panel container SHALL carry these class tokens: `relative`, `mt-2.5`, `rounded-lg`, `border border-[var(--border-subtle)]`, `px-2 pt-2.5 pb-1.5`, and SHALL carry no background (`bg-[…]`) class token.

The legend title SHALL be an absolutely-positioned `<span>` with class tokens: `absolute`, `-top-2`, `left-1/2`, `-translate-x-1/2`, `px-1.5`, `py-px`, `rounded-full`, `bg-[var(--bg-primary)]`, `border border-[var(--border-subtle)]`, `text-[11px]`, `font-semibold`, `uppercase`, `tracking-wide`, `text-[var(--text-secondary)]`, `leading-none`. It SHALL render the wrapper's `title` prop verbatim, and MAY host the subcard's legend menu. The legend's size, weight, tracking, overhang and colour match the folder slot pill legend (`directory-card-layout`); they take the `ui-contract.md` capsule-legend recipe (the `meta` 11 px step plus `uppercase`), and are pinned against the runtime's `SLOT_PILL_LEGEND` constant. The `mt-2.5` stacking gap and `pt-2.5` top padding SHALL keep a subcard's legend clear of the panel above it and of its own children.

#### Scenario: Subcard renders capsule legend and translucent panel
- **WHEN** `<SessionSubcard title="OPENSPEC">...</SessionSubcard>` is rendered with non-empty children
- **THEN** the rendered output SHALL contain a panel with class tokens `relative`, `mt-2.5`, `border`, `rounded-lg`, `pt-2.5` and no `bg-[` token, and not `mt-1.5` or `py-1.5`
- **AND** the panel SHALL contain a capsule `<span>` with text `OPENSPEC` carrying class tokens `absolute`, `-top-2`, `rounded-full`, `uppercase`, `tracking-wide`, `text-[11px]` and `text-[var(--text-secondary)]`, and not `text-[9px]`, `text-[12px]`, `tracking-wider` or `-top-1.5`
- **AND** the children SHALL be rendered inside the panel

#### Scenario: Stacked subcard legends do not overlap the panel above
- **WHEN** a desktop session card renders two or more subcards in sequence
- **THEN** each subcard legend's top edge lies at or below the bottom border edge of the element rendered directly above that subcard

#### Scenario: Subcard hides when children are null
- **WHEN** `<SessionSubcard title="MEMORY">{null}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing (no panel, no title row)

#### Scenario: Subcard hides when children are false
- **WHEN** `<SessionSubcard title="PROCESS">{false}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

#### Scenario: Subcard hides when children are an empty array
- **WHEN** `<SessionSubcard title="FLOWS">{[]}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

### Requirement: New plugin slot `session-card-flows` is reserved and consumed by FLOWS subcard
A new dashboard plugin slot identifier `session-card-flows` SHALL be added to `SLOT_DEFINITIONS` in `packages/shared/src/dashboard-plugin/slot-types.ts`. Multiplicity SHALL be `many`. Payload tier SHALL be `react-only` (matching `session-card-action-bar` and `session-card-memory`). The slot SHALL render its claims inside the FLOWS subcard. When no plugin claims the slot, the subcard renders nothing.

A matching consumer component `SessionCardFlowsSlot({ session })` SHALL be exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. The consumer SHALL render both legacy refs claims (filtered via `forSessionRendered`) and intent-store contributions (via `useSlotIntents("session-card-flows", session.id)`), each wrapped in a per-claim `SlotErrorBoundary` + `CurrentPluginLayer`.

The shell's `FlowsSubcard` wrapper SHALL call `useSlotHasClaimsForSession("session-card-flows", session)` and render `<SessionSubcard title="FLOWS">` only when the hook returns `true`. The wrapper SHALL render `SessionCardFlowsSlot` as its only child.

#### Scenario: Slot definition exists
- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "session-card-flows"` and `multiplicity: "many"`

#### Scenario: Plugin contribution renders inside FLOWS subcard
- **WHEN** a plugin registers a `session-card-flows` claim that returns a non-empty React node
- **AND** a desktop session card is rendered for the matching session
- **THEN** the rendered DOM SHALL contain a `FLOWS` titled subcard
- **AND** the plugin's contribution SHALL appear inside that subcard's body

#### Scenario: FlowsSubcard wrapper hides when hook reports zero claims
- **WHEN** the desktop session card is rendered for a session for which `useSlotHasClaimsForSession("session-card-flows", session)` returns `false`
- **THEN** no `SessionSubcard` titled `FLOWS` SHALL appear in the DOM

### Requirement: Mobile session card layout is unchanged
The mobile branch of `SessionCard.tsx` (gated by `useMobile()`) SHALL NOT use `SessionSubcard` wrappers. Mobile cards SHALL retain their flat row layout, except that any section resolved hidden by the `session-card-section-visibility` capability SHALL be omitted, and the PROCESS safety chip SHALL apply identically.

#### Scenario: Mobile card renders no subcard panels
- **WHEN** `useMobile()` returns true and a session card is rendered
- **THEN** no element with class token `bg-[var(--bg-surface)]` AND inset border styling characteristic of `SessionSubcard` SHALL appear inside the card
- **AND** no centered uppercase title element with content matching `OPENSPEC|WORKSPACE|PROCESS|MEMORY|FLOWS` SHALL appear

#### Scenario: Mobile card omits hidden sections
- **GIVEN** `useMobile()` returns true and folder `/a` hides `tags` and `process`
- **AND** a session in `/a` has tags and an in-flight bash tool
- **WHEN** its card renders
- **THEN** neither the tags strip nor the process rows SHALL render

### Requirement: Outer card chrome and pulse animations are preserved
The outer `<li>` element of the session card SHALL retain its existing classes for selection accent (`border-blue-500/60`, `ring-1 ring-blue-500/30` when selected), background (`bg-[var(--bg-tertiary)]`), rounded corners (`rounded-xl`), shadow, and pulse animations (`card-working-pulse`, `card-unread-pulse`) per the `session-card-status` and `sleek-card-design` capabilities.

#### Scenario: Selected card retains accent ring
- **WHEN** a session card is rendered as selected
- **THEN** the outer `<li>` SHALL have class tokens `border-blue-500/60` and `ring-1 ring-blue-500/30`
- **AND** introduction of subcards SHALL NOT change those classes

#### Scenario: Streaming card retains working pulse
- **WHEN** a session card is rendered with `session.status === "streaming"`
- **THEN** the outer `<li>` SHALL still carry `card-working-pulse` regardless of subcard contents

### Requirement: New plugin slot `session-card-memory` is reserved and consumed by MEMORY subcard
A new dashboard plugin slot identifier `session-card-memory` SHALL be added to `SLOT_DEFINITIONS` in `packages/shared/src/dashboard-plugin/slot-types.ts`. Multiplicity SHALL be `many`. Payload tier SHALL be `react-only` (matching `session-card-action-bar`). The slot SHALL render its claims inside the MEMORY subcard. When no plugin claims the slot, the subcard renders nothing.

A matching consumer component `SessionCardMemorySlot({ session })` SHALL be exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`.

#### Scenario: Slot definition exists
- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "session-card-memory"` and `multiplicity: "many"`

#### Scenario: Plugin contribution renders inside MEMORY subcard
- **WHEN** a plugin registers a `session-card-memory` claim that returns a non-empty React node
- **AND** a desktop session card is rendered for the matching session
- **THEN** the rendered DOM SHALL contain a `MEMORY` titled subcard
- **AND** the plugin's contribution SHALL appear inside that subcard's body

### Requirement: Plugin slot `workspace-action-bar` remains reserved
The plugin slot identifier `workspace-action-bar` SHALL continue to exist in `SLOT_DEFINITIONS` with multiplicity `many` and payload tier `react-only`. A matching consumer component `WorkspaceActionBarSlot({ session })` SHALL remain exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` unchanged in signature. No first-party plugin currently claims the slot.

#### Scenario: Slot definition still exists
- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "workspace-action-bar"` and `multiplicity: "many"`

### Requirement: `useSlotHasClaimsForSession` hook gates parent containers
The runtime SHALL export a hook `useSlotHasClaimsForSession(slotId, session): boolean` from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. The hook SHALL return `true` when at least one plugin claim for `slotId` matches the given session per the slot's targeting rules; otherwise `false`. It enables call sites (e.g. `WorkspaceSubcard`, `MemorySubcard`) to conditionally render a parent panel without invoking the slot's render path twice.

#### Scenario: Returns false when registry is unavailable
- **WHEN** the hook is called outside a `PluginContextProvider`
- **THEN** it SHALL return `false`

#### Scenario: Returns true when matching claim exists
- **WHEN** a plugin claims `session-card-memory` matching session `s1`
- **AND** the hook is called with `("session-card-memory", s1)`
- **THEN** it SHALL return `true`

### Requirement: Status indicator is the source icon colored by status
The round status dot at the start of the session card SHALL be replaced by the source MDI icon (`sourceIcons[session.source]`: `mdiConsoleLine` for `tui`, `mdiRobotOutline` for `dashboard`, `mdiApplicationOutline` for `tmux`, `mdiCodeTags` for `zed`). The icon's text color SHALL reflect session status, derived from `dotColor` by mapping leading `bg-<palette>` tokens to `text-<palette>` (regex `/\bbg-(?!\[)/g`). For `session.status === "ended"` the icon SHALL use `text-[var(--text-muted)]`.

The icon span SHALL carry `data-testid="session-status-icon"` and `title={"<sourceLabel> — <status>"}`. This requirement applies to BOTH desktop and mobile branches of `SessionCard.tsx`.

#### Scenario: Active session shows green source icon
- **WHEN** a session card is rendered with `source: "tui"` and `status: "active"`
- **THEN** the DOM SHALL contain an element with `data-testid="session-status-icon"` carrying class `text-green-500`
- **AND** an SVG path matching `mdiConsoleLine` SHALL be present inside it

#### Scenario: Ended session uses muted color
- **WHEN** a session card is rendered with `status: "ended"`
- **THEN** the `session-status-icon` element SHALL carry class `text-[var(--text-muted)]`

#### Scenario: Error overrides retry which overrides status
- **WHEN** a session card is rendered with `hasError: true` AND `isRetrying: true`
- **THEN** the `session-status-icon` element SHALL carry class `text-red-500`
- **AND** SHALL NOT carry class `text-amber-500`

### Requirement: Card left gutter is the drag handle (no overlay icon)
`SortableSessionCard` SHALL NOT render any visible drag-handle icon overlay. It SHALL provide its dnd-kit `attributes` and `listeners` to descendant cards via a React context (`DragHandleCtx`) exported as a hook `useSessionCardDragHandle()`.

The desktop branch of `SessionCard.tsx` SHALL consume the context and spread the handle props onto its left gutter `<div>` (the column containing the status icon). The gutter SHALL carry `cursor-grab active:cursor-grabbing` when context is non-null, and `data-testid="drag-handle-session"`. Click events on the gutter SHALL stop propagation when handle props are present so the gutter does not double as a select target during drag.

#### Scenario: Drag handle context provided by SortableSessionCard
- **WHEN** a SessionCard is rendered as a child of SortableSessionCard
- **THEN** the gutter `<div>` SHALL carry `data-testid="drag-handle-session"` and class tokens `cursor-grab`, `active:cursor-grabbing`

#### Scenario: Drag handle absent without context
- **WHEN** a SessionCard is rendered without a SortableSessionCard ancestor
- **THEN** the gutter `<div>` SHALL NOT carry `data-testid="drag-handle-session"` and SHALL NOT carry `cursor-grab`

#### Scenario: No legacy drag-handle icon overlay
- **WHEN** a SortableSessionCard is rendered
- **THEN** the rendered DOM SHALL NOT contain an absolute-positioned span with the `mdiDragHorizontalVariant` icon path

### Requirement: Missing-folder pill on session card
The desktop session card's title row SHALL render a small red pill when `session.cwdMissing === true`, independent of git state. The pill reads `folder missing` (i18n key `common.cwdGone`) and carries `data-testid="cwd-gone-pill"`. Its tooltip states that the session's folder no longer exists. Placement and styling are defined by the `session-card-header` capability.

#### Scenario: Pill renders for cwd-missing session
- **WHEN** the card renders a session with `cwdMissing: true`
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]` with text `folder missing`
- **AND** no `[data-testid="cwd-gone-pill"]` SHALL render inside the git row

#### Scenario: Pill renders without git
- **WHEN** the card renders a session with `cwdMissing: true` and no `gitBranch`
- **THEN** the title row SHALL contain `[data-testid="cwd-gone-pill"]`

#### Scenario: Pill absent for healthy session
- **WHEN** `cwdMissing` is `undefined` or `false`
- **THEN** the pill SHALL NOT render

### Requirement: Resume button disabled when cwd missing
When `session.cwdMissing === true`, the desktop session card's Resume action, an item of the session actions menu, SHALL be disabled with the reason "session's directory no longer exists".

#### Scenario: Resume disabled
- **WHEN** the user opens the session actions menu of a cwd-missing ended session
- **THEN** the Resume item SHALL be `aria-disabled="true"`
- **AND** its reason SHALL read "session's directory no longer exists"

### Requirement: PROCESS subcard composition
The PROCESS subcard SHALL present its in-flight bash activity and background-process inventory through a single collapsible summary line of fixed height, so that starting or finishing a tool does not change the subcard's collapsed height. The subcard SHALL NOT render a variable stack of always-open rows whose count changes the card height.

The subcard's presence at idle SHALL be governed by the `reserveProcessLineAtIdle` display preference (effective value from `useDisplayPrefs(session.id)`).

#### Scenario: Collapsed height invariant across tool count
- **GIVEN** the PROCESS summary line is collapsed
- **WHEN** the number of in-flight bash tools changes between 0, 1, and 3
- **THEN** the collapsed subcard height SHALL remain unchanged

#### Scenario: Idle with reservation off hides the subcard
- **GIVEN** no in-flight bash tools and no background processes
- **AND** effective `reserveProcessLineAtIdle` is `false`
- **WHEN** the PROCESS subcard renders
- **THEN** it SHALL render nothing (returns null)

#### Scenario: Idle with reservation on shows one reserved line
- **GIVEN** no in-flight bash tools and no background processes
- **AND** effective `reserveProcessLineAtIdle` is `true`
- **WHEN** the PROCESS subcard renders
- **THEN** it SHALL render exactly one reserved summary line with an idle indicator

#### Scenario: Expanding reveals the full body
- **GIVEN** the collapsed summary line with one or more in-flight bash tools and/or background processes
- **WHEN** the user activates (clicks) the summary line
- **THEN** it SHALL expand in place to show every in-flight bash row followed by every background-process row
- **AND** the expand/collapse state SHALL persist per session via the existing process-drawer collapse persistence

### Requirement: Per-session drawer toggle state
The session card SHALL own per-session client state for the drawer's user-overridden expansion. The override SHALL persist for the lifetime of the client session and SHALL take precedence over the contextual default.

#### Scenario: Toggle persists across content changes
- **GIVEN** the user has collapsed the drawer in a pure-orphan state (default was expanded)
- **WHEN** the activity bar gains and loses an in-flight tool, then becomes empty again
- **THEN** the drawer SHALL render collapsed (user override wins)

#### Scenario: Toggle is per-session
- **GIVEN** session A has its drawer collapsed via user toggle
- **WHEN** session B renders for the first time
- **THEN** session B's drawer SHALL use the contextual default (no inherited state from session A)

### Requirement: +Session sibling-spawn button on session card
The desktop session card SHALL offer an always-available New session action (formerly the inline `+Session` button) as an item of the session actions menu's SESSION group, with test id `session-card-spawn-sibling`. Unlike Fork/Resume, this action SHALL NOT be gated on `session.status === "ended"` or on the presence of `session.sessionFile` — it is offered for live and ended sessions alike.

Activation SHALL emit a `spawn_session` ws message with:
- `cwd` set to the parent session's `cwd`,
- `attachProposal` set to the parent session's `attachedProposal` when that field is a non-empty string (omitted otherwise),
- a fresh `requestId` (UUIDv4).

The action SHALL be disabled when `session.cwdMissing === true`, with the reason `session's directory no longer exists`.

The action SHALL NOT carry `gitWorktreeBase` or any worktree-related metadata. Worktree-sibling spawning is covered by separate surfaces (New worktree session, folder `+Worktree`, per-change `⑂+`).

The action SHALL use the green session-spawn palette, consistent with every other session-spawn control (`FolderSpawnButtons` `+ New Session`, folder-section `spawn-attached`). Session-spawn actions SHALL NOT use the purple `accent` palette, which is reserved for OpenSpec actions (Attach / Archive).

#### Scenario: Visible on live session
- **WHEN** the session actions menu opens for a session with any non-ended status
- **THEN** the New session item SHALL render
- **AND** Fork SHALL render only when the session has a `sessionFile`, and Resume SHALL NOT render

#### Scenario: Visible on ended session alongside Fork
- **WHEN** the session actions menu opens for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** New session, Resume and Fork SHALL all render in the SESSION group

#### Scenario: Click inherits cwd and proposal
- **WHEN** the user activates New session on a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` ws message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"`, and a UUIDv4 `requestId`

#### Scenario: Click omits proposal when parent has none
- **WHEN** the user activates New session on a session whose `attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the emitted `spawn_session` payload SHALL omit the `attachProposal` key entirely (not send empty string)

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the New session item SHALL be `aria-disabled="true"` with reason `session's directory no longer exists`
- **AND** activating it SHALL NOT emit a `spawn_session` message

### Requirement: +Worktree button on session card
The desktop session card SHALL offer a New worktree session action (formerly the inline `+Worktree` button) as an item of the session actions menu's SESSION group, with test id `session-card-spawn-worktree`.

It SHALL be gated by the `gitWorktreeEnabled` config flag (default true), mirroring the folder-header `+Worktree` gate. It SHALL NOT be gated on `session.status` or `session.sessionFile`.

It SHALL be hidden in either of these cases:
- the session is already a worktree session (`session.gitWorktree` set), since spawning a worktree from inside a worktree is redundant;
- the session's cwd is a **confirmed non-git** directory, `session.isGitRepo === false`.

It SHALL remain offered when `session.isGitRepo` is `true` OR `undefined` (unknown / not-yet-probed / legacy). A git repo whose probe timed out, or a session predating the signal, must never lose the action. The gate SHALL NOT use `session.gitBranch`: that is a data-arrival signal, absent during the register race, on probe failure and after a server restart for cold sessions, so it would wrongly hide the action for real git repos.

Activation SHALL open the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`.
- When `session.attachedProposal` is a non-empty string, the dialog SHALL open via the proposal-aware path (pre-filled branch `os/<change>`, with `attachProposal` carried through).
- Otherwise it SHALL open via the plain path (no proposal).

The action SHALL be disabled when `session.cwdMissing === true`, with reason `session's directory no longer exists`. The card SHALL NOT implement its own worktree-creation, bootstrap or `spawn_session` logic; it reuses the dialog's existing machinery.

#### Scenario: Visible next to +Session in a git repo
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false`, a worktree handler supplied, AND `session.isGitRepo === true`
- **THEN** the New worktree session item SHALL render after New session

#### Scenario: Hidden when worktrees disabled
- **WHEN** the dashboard config has `gitWorktreeEnabled === false`
- **THEN** the New worktree session item SHALL NOT render (the New session item is unaffected)

#### Scenario: Hidden in a confirmed non-git folder
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false` and a worktree handler supplied, but `session.isGitRepo === false`
- **THEN** the New worktree session item SHALL NOT render
- **AND** the New session item SHALL be unaffected

#### Scenario: Visible when git status is unknown (no regression)
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false` and a worktree handler supplied, and `session.isGitRepo` is `undefined` (probe inconclusive, register race, or legacy session)
- **THEN** the New worktree session item SHALL render (unknown is not treated as non-git)

#### Scenario: Click with proposal opens proposal-aware dialog
- **WHEN** the user activates New worktree session on a session with `attachedProposal = "add-dark-mode"`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with branch pre-filled `os/add-dark-mode` and `attachProposal` carried through

#### Scenario: Click without proposal opens plain dialog
- **WHEN** the user activates New worktree session on a session with no `attachedProposal`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with no pre-filled proposal

### Requirement: OPENSPEC subcard visibility is governed by broadcast readiness

The OPENSPEC subcard's gate SHALL be the cwd's broadcast readiness state (see
`openspec-readiness`), replacing the `openspecHasDir || openspecPending` condition currently
evaluated in `SessionCard.tsx` and the equivalent condition in `ComposerSessionActions.tsx`.

| readiness state | OPENSPEC subcard |
|---|---|
| `GLOBAL_OFF` | hidden |
| `OPTED_OUT` | hidden |
| `ABSENT` | hidden |
| `PENDING` | existing placeholder |
| `BROKEN` | rendered **disabled** |
| `STALE` | rendered **disabled** |
| `READY` | rendered live when the session has an attachment to show; not rendered on the desktop card for an unattached session (its actions are in the session actions menu) |

`ABSENT` hides rather than disabling: initialization is offered once on the folder card, not
repeated on every session card in that directory.

When `readiness` is absent from the payload — an older server — the gate SHALL degrade to the
previous `hasOpenspecDir || pending` behaviour and SHALL NOT render a disabled subcard.

#### Scenario: Directory with no OpenSpec hides the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `ABSENT`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: Partially initialized directory disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `BROKEN`
- **THEN** an element with title text `OPENSPEC` SHALL appear
- **AND** it SHALL NOT render the Explore, Propose, Attach, or Archive controls

#### Scenario: Valid project with no pi skills disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `STALE`
  with reason `missing-skills`
- **THEN** the OPENSPEC subcard SHALL render disabled
- **AND** the reason text SHALL indicate that the project's OpenSpec skills are missing

#### Scenario: Ready project renders live controls

- **WHEN** a desktop session card is rendered for a session attached to a change, whose cwd readiness is `READY`
- **THEN** the OPENSPEC subcard SHALL render live: the attached change link and the lifecycle bar
- **AND WHEN** the session has no attachment
- **THEN** no OPENSPEC subcard SHALL render, and the session actions menu SHALL offer the unattached OpenSpec actions

#### Scenario: Legacy server degrades to previous behaviour

- **WHEN** the client receives `OpenSpecData` with no `readiness` field
- **THEN** the subcard SHALL render exactly as it does today
- **AND** no disabled variant SHALL be shown

### Requirement: Disabled OPENSPEC subcard is inert and routes to a surface that can remediate

A disabled OPENSPEC subcard SHALL render a reason line describing why OpenSpec is unavailable
for this directory, and exactly one focusable control.

Every action control that the live subcard would render SHALL be **absent from the DOM**, not
merely visually dimmed. A control that is focusable but silently does nothing is a worse
failure than the state this change removes, because it fails identically while appearing
deliberate.

The single control SHALL target the surface that can actually resolve the reported reason:

| reason | control target |
|---|---|
| `missing-changes-dir`, `cli-failed` (`BROKEN`) | the folder card's OpenSpec section |
| `missing-skills` (`STALE`) | the folder card's OpenSpec section |
| `profile-stale` (`STALE`) | Settings → OpenSpec Workflow Profile |

A control pointing at a surface that cannot remediate the reported reason SHALL NOT be
rendered.

When the target is the folder card's OpenSpec section, activating the control SHALL scroll that
folder's header into view, expand the folder group if it is collapsed, and move focus to the
OpenSpec section. It SHALL NOT open a Repair or Update dialog from the session card — the
session card reports readiness and never acts on it.

The reason text SHALL be the accessible explanation — not a `title` attribute — and SHALL
distinguish each reason.

#### Scenario: No action controls in the tab order

- **WHEN** the OPENSPEC subcard renders disabled
- **THEN** the only focusable element within it SHALL be the single remediation control

#### Scenario: Broken state routes to the folder card

- **WHEN** the subcard renders disabled with reason `missing-changes-dir`
- **THEN** its control SHALL target the folder card's OpenSpec section
- **AND** it SHALL NOT target the Settings profile section

#### Scenario: Routing scrolls and expands a collapsed folder

- **WHEN** the user activates the control on a disabled subcard whose folder group is collapsed
- **THEN** the folder group SHALL be expanded
- **AND** its header SHALL be scrolled into view
- **AND** focus SHALL move to the OpenSpec section
- **AND** no Repair or Update dialog SHALL open

#### Scenario: Profile staleness routes to Settings

- **WHEN** the subcard renders disabled with reason `profile-stale`
- **THEN** its control SHALL target the settings surface containing the OpenSpec Workflow
  Profile section

#### Scenario: Reason text distinguishes the states

- **WHEN** the subcard renders disabled for `BROKEN`
- **THEN** the reason text SHALL differ from the text rendered for each `STALE` reason

### Requirement: Worktree card-slot claims are spaced like subcards
The session card's worktree card-slot wrapper (`data-testid="worktree-card-section-gap"`, which hosts every `worktree-card-section` claim such as the KB and MCP slot pills) SHALL carry `mt-2.5`, `flex`, `flex-col` and `gap-2.5`, so that each claim's capsule legend clears both the subcard above the wrapper and the claim above it within the wrapper, by the same stacking gap as `SessionSubcard`.

#### Scenario: Wrapper carries the stacking tokens
- **WHEN** a desktop session card renders for a session whose `gitWorktree` is set
- **THEN** the `worktree-card-section-gap` element carries `mt-2.5`, `flex`, `flex-col` and `gap-2.5`, and not `mt-1.5`

#### Scenario: Second card-slot claim legend does not reach into the first
- **WHEN** the worktree card slot renders two claims (KB, then MCP) at 768 and 1440 px
- **THEN** the second claim's legend top edge lies at or below the first claim's bottom border edge

### Requirement: STATUS subcard hides when no badge claim would render

The STATUS subcard (slot `session-card-badge`) SHALL render its panel and `STATUS` title only
when at least one registry claim on that slot passes its `predicate` / `shouldRender` for the
session and the host per-plugin visibility filter. Every registry claim on `session-card-badge`
SHALL declare a `predicate` or `shouldRender` whose condition matches the claim component's own
render/skip condition. Intent-store contributions are not counted by this gate; a badge
contributed only via the intent store MAY be hidden.

The browser plugin's `BrowserRelayBadge` claim SHALL declare a `shouldRender` that returns
`true` **iff** the latest relay status snapshot reports at least one tab on any instance, which is
the same condition under which the component renders. The relay status subscription SHALL NOT
depend on the badge or any session card being mounted. When the relay snapshot changes between
"no tabs" and "at least one tab", the STATUS gate SHALL re-evaluate without requiring a session
broadcast. The relay snapshot SHALL be refreshed when the shell connection becomes connected,
so a snapshot from before a disconnect does not persist; if the refresh fails, the snapshot
SHALL be cleared. The composer's STATUS group, which uses the same slot, SHALL follow the same
gate.

#### Scenario: STATUS subcard hidden when the browser plugin is enabled with no relay tabs

- **WHEN** a desktop session card is rendered with the browser plugin enabled
- **AND** the latest relay status reports zero tabs across all instances
- **AND** the session has no goal and is not an automation run
- **THEN** no element with title text `STATUS` SHALL appear

#### Scenario: STATUS subcard appears when the first relay tab arrives

- **WHEN** a desktop session card is rendered with the browser plugin enabled and zero relay tabs
- **AND** a `browser_relay_status` message then reports one tab, with no session broadcast
- **THEN** an element with title text `STATUS` SHALL appear containing the browser relay badge

#### Scenario: STATUS subcard hides again when the last relay tab closes

- **WHEN** the STATUS subcard is showing only the browser relay badge
- **AND** a `browser_relay_status` message reports zero tabs
- **THEN** no element with title text `STATUS` SHALL appear

#### Scenario: Relay status is received with no session card mounted

- **WHEN** the browser plugin is enabled and no session card is rendered
- **AND** a `browser_relay_status` message reports one tab
- **THEN** the relay store SHALL hold that snapshot
- **AND** a session card mounted afterwards SHALL show the `STATUS` subcard with the badge

#### Scenario: Relay snapshot is refreshed after reconnect

- **WHEN** the relay store holds a snapshot with one tab
- **AND** the shell connection drops and reconnects while the relay now reports zero tabs
- **THEN** the relay store SHALL be refreshed to zero tabs
- **AND** no element with title text `STATUS` SHALL appear for a session with no goal and no
  automation run

#### Scenario: Failed refresh after reconnect clears the snapshot

- **WHEN** the relay store holds a snapshot with one tab
- **AND** the shell connection reconnects and the relay status refresh request fails
- **THEN** the relay store SHALL be cleared
- **AND** no element with title text `STATUS` SHALL appear for a session with no goal and no
  automation run

#### Scenario: Composer STATUS group hidden with zero relay tabs

- **WHEN** the chat composer is rendered for a session with no goal and no automation run
- **AND** the browser plugin is enabled and the latest relay status reports zero tabs
- **THEN** the composer SHALL render no STATUS group label

#### Scenario: Every session-card-badge registry claim is gated

- **WHEN** the generated plugin registry is loaded
- **THEN** every registry claim on slot `session-card-badge` SHALL declare a `predicate` or
  `shouldRender`

### Requirement: Desktop session card keeps only state and its inline controls

The desktop session card SHALL render no action chips, no action rows, and no per-subcard option menus.

**Kept on the card:**
- **Header controls:** the Archive button (when archiving is offered) and the Exit ✕ button (for alive sessions). The session actions trigger SHALL NOT render in the header.
- **Edge control:** the session actions trigger, centred on the card's right edge (see `session-actions-menu`).
- **Controls that act on one running thing**, unchanged:
  - the PROCESS subcard's row controls (stop an individual in-flight tool, kill a background process, expand or collapse the drawer);
  - the `ProcessSafetyChip` that replaces a hidden PROCESS subcard;
  - the abort control on a running flow's status in the FLOWS subcard.
- **The disabled-OPENSPEC remediation control.**
- **Clickable status:** the OpenSpec lifecycle bar, the attached change link, the archived / missing / main-checkout letters and badges, the git branch control, the dirty-files pill, the PR link, and plugin status pills (for example, KB / MCP worktree pills).

Every other action SHALL be reached through the session actions menu (`session-actions-menu`).

The `session-card-action-bar` slot's output SHALL NOT render on the desktop card, although its claims stay mounted (see `session-actions-menu`). The Rename button SHALL NOT render in the header; double-clicking the name SHALL still start an inline rename, and Rename… is offered in the menu.

#### Scenario: No action chips on an ended session card
- **WHEN** a desktop card renders for an ended session with a `sessionFile` in a git repo
- **THEN** no Resume, Fork, +Session or +Worktree button SHALL render on the card
- **AND** the header SHALL render the Archive button
- **AND** the card SHALL render `session-actions-trigger-<id>` on its right edge, outside the header

#### Scenario: PROCESS row controls stay on the card
- **WHEN** a desktop card renders for a session with an in-flight bash tool and a background process
- **THEN** the tool row's stop control and the process row's kill control SHALL render inside the PROCESS subcard as before
- **AND** no Archive button SHALL render (unchanged rule: never archive while running)

#### Scenario: Disabled OPENSPEC keeps its remediation control
- **WHEN** a desktop card renders an OPENSPEC subcard in a BROKEN readiness state
- **THEN** its single remediation control SHALL render and route as before

#### Scenario: Double-click rename still works
- **WHEN** the user double-clicks the session name on a non-ended desktop card
- **THEN** the inline rename input SHALL appear

### Requirement: Subcards render nothing when their content is empty

Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no
element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

For MEMORY, WORKSPACE, and FLOWS, the wrapper's visibility is governed by the `shouldRender`
claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no
plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that
registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender`
**whose boolean condition matches the claim component's own render/skip condition**, so the
wrapper never renders an empty panel.

For the FLOWS subcard specifically, the `session-card-flows` claim (`SessionFlowActionsClaim`)
now renders only flow status; the flow actions moved to the session actions menu (see
`flows-plugin`). The claim returns `null` when the session has no flow event. Its `shouldRender`
predicate SHALL therefore return `true` **iff** the session has at least one flow event (a flow
is running or has run). The predicate SHALL NOT open on `flowsList` contents, on edit mode, or
on mere pi-flows extension presence.

**The OPENSPEC subcard is exempt from the empty-content rule.** Its visibility is governed by
readiness, and in the `BROKEN` and `STALE` states it renders deliberately with no action
controls. An OPENSPEC panel containing only a reason line and a single remediation control
SHALL NOT be treated as empty.

#### Scenario: Empty PROCESS subcard is hidden

- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: Control-less OPENSPEC subcard is not treated as empty

- **WHEN** the OPENSPEC subcard renders disabled, containing only a reason line and a single
  remediation control
- **THEN** the panel and its `OPENSPEC` title SHALL still render

#### Scenario: FLOWS subcard hidden without flow activity

- **WHEN** a desktop session card is rendered for a session whose cwd has the pi-flows
  extension loaded (a `flows` command is present)
- **AND** the session's `flowsList` is empty
- **AND** the session's effective flows edit mode (`flows.editFlow`, project overriding global) is off
- **AND** the session has no flow event (no flow running or previously run)
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** no empty flows panel SHALL be rendered

#### Scenario: Edit mode alone does not show the FLOWS subcard

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList`
- **AND** the session's effective flows edit mode (`flows.editFlow`, project overriding global) is on
- **AND** the session has no flow event
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** the author-first **New / Edit…** entry point SHALL be offered in the session actions menu instead

#### Scenario: FLOWS subcard appears once a flow has run

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList` and edit
  mode off
- **AND** the session has at least one flow event (a flow ran or is running)
- **THEN** an element with title text `FLOWS` SHALL appear

### Requirement: Desktop session card body groups sections into five subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`.

The header zone SHALL remain outside any subcard, above the first subcard. Its rows are defined by the `session-card-header` capability:
- the title row: status chip, name (double-click to rename), missing-folder pill, time, then the Archive / Exit controls (the session actions trigger is not in the header; it sits on the card's right edge, see `session-actions-menu`);
- the status row;
- the git row;
- the meta row: model, session chips, context bar, cost.

The header zone SHALL NOT contain action chips (Resume, Fork, +Session, +Worktree); those actions live in the session actions menu. No footer action row SHALL render below the last subcard. The session actions edge trigger is absolutely positioned at the card's vertical centre, so it does not count as rendering below the last subcard. The `session-card-action-bar` slot's output renders in the session actions menu.

The worktree card-slot wrapper (`data-testid="worktree-card-section-gap"`) keeps its position directly after the OPENSPEC subcard, so it now precedes `STATUS`, and keeps its stacking tokens.

There SHALL be no `GIT` subcard and no `WORKSPACE` subcard. Git branch / PR / worktree / dirty information is clickable status in the header git row. Worktree actions live in the session actions menu's GIT group. The `STATUS` subcard hosts the `session-card-badge` slot (goal / automation badge contributions).

#### Scenario: All five subcard titles appear in order when populated
- **WHEN** a desktop session card is rendered with content for every subcard
- **THEN** the rendered DOM SHALL contain centered title elements `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY` in that document order

#### Scenario: Header zone stays outside subcards
- **WHEN** a desktop session card is rendered
- **THEN** the session name, status row, git row and meta row SHALL render before the first `SessionSubcard` element
- **AND** none of those elements SHALL be descendants of a `SessionSubcard`

#### Scenario: GIT and WORKSPACE subcards no longer rendered
- **WHEN** a desktop session card is rendered for a worktree session with `gitBranch` set
- **THEN** no element with title text `GIT` or `WORKSPACE` SHALL appear in the rendered DOM

#### Scenario: No footer action row and no worktree actions row
- **WHEN** a desktop session card is rendered for a worktree session with an action-bar plugin claim
- **THEN** no element SHALL render below the last subcard (the absolutely positioned session actions edge trigger, vertically centred on the card, is not below it even though it is the card root's last DOM child)
- **AND** the card SHALL NOT contain the Push, Open PR, Merge or Close worktree action buttons
- **AND** the git row's PR status link (`data-testid="worktree-pr-segment"`) is clickable status, not one of these action buttons

### Requirement: Header git row renders worktree pill when session is in a git worktree
When the header git row renders (see `session-card-header`) and `session.gitWorktree` is set, the git row SHALL render an inline `worktree` pill as its **first** element, before the `⎇ <branch>` text. The branch text itself SHALL be unchanged.

The pill SHALL carry class tokens `inline-flex`, `items-center`, `px-1.5 py-px`, `rounded-full`, `text-[11px]`, `font-semibold`, `flex-shrink-0`, `border border-[var(--tint-orange-border)]`, `text-[var(--tint-orange-fg)]`, `bg-[var(--tint-orange-bg)]`. It SHALL carry `data-testid="worktree-pill"`.

The pill SHALL render the bare text `worktree`, never the worktree name. When `session.gitWorktree.base` is also set, the pill's `title` attribute SHALL be `created from <base>`; when absent, `git worktree`. The pill SHALL NOT appear in the `STATUS` subcard.

#### Scenario: Session in worktree shows pill first in the git row
- **WHEN** a session card is rendered for a session with `gitWorktree: { mainPath: "/repo", name: "feat-x" }` and `gitBranch: "feat/dark"`
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the header git row SHALL contain an element with `data-testid="worktree-pill"` and text `worktree`
- **AND** the pill SHALL appear before the `feat/dark` branch element in document order

#### Scenario: Worktree pill does NOT appear in STATUS subcard
- **WHEN** a session card is rendered for a session with `gitWorktree` set AND a plugin claims `session-card-badge`
- **THEN** the `STATUS` titled subcard SHALL NOT contain any element with `data-testid="worktree-pill"`

#### Scenario: Pill tooltip with known base
- **WHEN** a session has `gitWorktree.base: "develop"`
- **THEN** the pill's `title` attribute SHALL be `created from develop`

#### Scenario: Pill tooltip without known base
- **WHEN** a session has `gitWorktree` set but `gitWorktree.base` is absent
- **THEN** the pill's `title` attribute SHALL be `git worktree`

#### Scenario: Session in main checkout has no pill
- **WHEN** a session card is rendered for a session with `gitWorktree` absent or `undefined`
- **THEN** the rendered DOM SHALL NOT contain any element with `data-testid="worktree-pill"`

#### Scenario: Branch text unchanged for worktree sessions
- **WHEN** a session card is rendered for a worktree session
- **THEN** the git row SHALL display `⎇ <branch>` exactly as it would for a non-worktree session (no replacement, no folder-name substitution)

#### Scenario: Mobile session card omits worktree pill
- **WHEN** the session card is rendered in mobile layout (no `SessionSubcard` wrappers)
- **THEN** the worktree pill SHALL NOT be rendered
- **AND** the mobile flat layout SHALL remain unchanged
