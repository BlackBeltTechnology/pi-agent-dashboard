# Session Card Subcards

## Purpose

Group desktop session card sections into translucent inset panels (subcards) with capsule legend titles. Each subcard wraps a related cluster of controls (OPENSPEC / WORKSPACE / PROCESS / MEMORY / FLOWS) and hides itself when empty. Mobile layout unchanged. Reserves plugin slots `session-card-memory` and `workspace-action-bar`, replaces the round status dot with a status-colored source icon, and turns the card's left gutter into the drag handle.
## Requirements
### Requirement: Subcard wrapper component renders translucent inset panel with capsule legend title
The desktop session card SHALL group related controls inside `SessionSubcard` wrappers. Each `SessionSubcard` SHALL render a translucent inset panel using `color-mix` over the card body color, with a small uppercase capsule (pill) legend overhanging the panel's top border (fieldset-legend style).

The panel container SHALL carry these class tokens: `relative`, `mt-1.5`, `rounded-lg`, `border border-[var(--border-subtle)]`, `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]`, `px-2 py-1.5`.

The legend title SHALL be an absolutely-positioned `<span>` with class tokens: `absolute`, `-top-1.5`, `left-1/2`, `-translate-x-1/2`, `px-1.5`, `py-px`, `rounded-full`, `bg-[var(--bg-tertiary)]`, `border border-[var(--border-subtle)]`, `text-[9px]`, `uppercase`, `tracking-wider`, `text-[var(--text-muted)]`, `leading-none`. It SHALL render the wrapper's `title` prop verbatim.

#### Scenario: Subcard renders capsule legend and translucent panel
- **WHEN** `<SessionSubcard title="OPENSPEC">...</SessionSubcard>` is rendered with non-empty children
- **THEN** the rendered output SHALL contain a panel with class tokens `relative`, `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]`, `border`, `rounded-lg`
- **AND** the panel SHALL contain a capsule `<span>` with text `OPENSPEC` carrying class tokens `absolute`, `-top-1.5`, `rounded-full`, `uppercase`
- **AND** the children SHALL be rendered inside the panel

#### Scenario: Subcard hides when children are null
- **WHEN** `<SessionSubcard title="MEMORY">{null}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing (no panel, no title row)

#### Scenario: Subcard hides when children are false
- **WHEN** `<SessionSubcard title="PROCESS">{false}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

#### Scenario: Subcard hides when children are an empty array
- **WHEN** `<SessionSubcard title="FLOWS">{[]}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

### Requirement: Desktop session card body groups sections into six subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `GIT`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`. The header zone (status dot, name + rename, time, hide/close icons, model + thinking-level + Fork button, activity row with context bar + cost) SHALL remain outside any subcard, above the first subcard. The footer plugin slot `SessionCardActionBarSlot` SHALL remain outside any subcard, below the last subcard.

The previous `WORKSPACE` subcard SHALL be removed and replaced by two sibling subcards `GIT` and `STATUS` rendered in that order. The `GIT` subcard hosts git branch / PR / worktree information and the new `WorktreeActionsMenu` row when applicable. The `STATUS` subcard hosts the `session-card-badge` slot (goal / automation badge contributions).

#### Scenario: All six subcard titles appear in order when populated
- **WHEN** a desktop session card is rendered with content for every subcard
- **THEN** the rendered DOM SHALL contain centered title elements `OPENSPEC`, `GIT`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY` in that document order

#### Scenario: Header zone stays outside subcards
- **WHEN** a desktop session card is rendered
- **THEN** the session name, model line, and activity/cost row SHALL render before the first `SessionSubcard` element
- **AND** none of those elements SHALL be descendants of a `SessionSubcard`

#### Scenario: WORKSPACE subcard no longer rendered
- **WHEN** a desktop session card is rendered
- **THEN** no element with title text `WORKSPACE` SHALL appear in the rendered DOM

### Requirement: Subcards hide when their content is empty
Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

| Subcard | Renders only when |
|---|---|
| OPENSPEC | `openspecChanges && onSendPrompt && onAttachProposal && onDetachProposal` AND `SessionOpenSpecActions` produces output (attached proposal OR available changes OR phase) AND the dashboard `openspec.enabled` config is `true` AND the per-cwd `OpenSpecData` indicates the directory is OpenSpec-applicable (`hasOpenspecDir === true` OR `pending === true`) |
| GIT | `showGitInfo === true` OR `session.gitWorktree` is set |
| STATUS | A plugin contributes to the `session-card-badge` slot whose `shouldRender` (if declared) returns `true` for the session |
| PROCESS | `processes && processes.length > 0 && onKillProcess` |
| FLOWS | A plugin contributes to the `session-card-flows` slot whose `shouldRender` (if declared) returns `true` for the session. Claims without a `shouldRender` declaration are treated as always rendering. |
| MEMORY | A plugin contributes to the `session-card-memory` slot whose `shouldRender` (if declared) returns `true` for the session. Claims without a `shouldRender` declaration are treated as always rendering. |

The new OPENSPEC sub-conditions distinguish *"feature applicable, nothing happening yet"* (still show the attach/init CTA) from *"feature not applicable here"* (hide entirely). The visibility signal is `OpenSpecData.hasOpenspecDir`:

- `openspec.enabled === false` means the user has globally disabled OpenSpec in settings — server broadcasts `hasOpenspecDir: false` for every cwd — hide.
- `OpenSpecData.hasOpenspecDir === false && pending === false` means the server has confirmed there is no `openspec/` directory in the session's `cwd` — hide.
- `OpenSpecData.pending === true` means the server is still polling — show.
- `OpenSpecData.hasOpenspecDir === true && initialized === false` means the project is OpenSpec-initialized (`openspec/` directory exists) but no `openspec/changes/` subdir yet (no proposals authored) — show (init/attach CTA).
- `OpenSpecData.initialized === true` means full poll returned data — show.

The `hasOpenspecDir` field is strictly weaker than `initialized`: `initialized === true` implies `hasOpenspecDir === true`, but `hasOpenspecDir === true` does NOT imply `initialized === true` (the `openspec/changes/` subdir may not exist yet). The session-card visibility gate consults `hasOpenspecDir` (not `initialized`) so freshly-initialized OpenSpec projects without proposals still surface the OPENSPEC subcard.

For MEMORY, STATUS, and FLOWS, the wrapper's visibility is now governed by the new `shouldRender` claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender` so the wrapper does not render an empty panel.

The OPENSPEC subcard SHALL receive enough information to evaluate `OpenSpecData.hasOpenspecDir`, `OpenSpecData.initialized`, and `OpenSpecData.pending`. The exact prop shape is left to implementation; either passing `openspecData?: OpenSpecData` in place of `openspecChanges?: OpenSpecChange[]`, or passing sibling props `openspecHasDir?: boolean`, `openspecInitialized?: boolean`, `openspecPending?: boolean` alongside `openspecChanges` is acceptable. Existing callers without the new signal SHALL behave as if the directory is OpenSpec-applicable (preserve current visibility) until the parent is updated.

The GIT subcard's predicate is strictly git-scoped: it SHALL NOT consider plugin slot claims. The STATUS subcard's predicate is strictly plugin-scoped (it consults `session-card-badge` slot claims): it SHALL NOT consider `showGitInfo` or `session.gitWorktree`. Both subcards SHALL render independently — when both a git signal and a `session-card-badge` claim are present, both subcards SHALL appear; with only a git signal, only `GIT`; with only a `session-card-badge` claim, only `STATUS`; in neither, both hide.

#### Scenario: Git signal and badge claim show both GIT and STATUS subcards
- **WHEN** a desktop session card is rendered with `showGitInfo === true` AND a plugin claims `session-card-badge` matching the session
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL contain a `STATUS` titled subcard
- **AND** `GIT` SHALL appear before `STATUS` in document order

#### Scenario: Pure-git repo shows only GIT subcard
- **WHEN** a desktop session card is rendered with `showGitInfo === true` AND no plugin claims `session-card-badge` for the session
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL NOT contain a `STATUS` titled subcard

#### Scenario: Badge claim only shows only STATUS subcard
- **WHEN** a desktop session card is rendered with `showGitInfo === false` AND `session.gitWorktree` is undefined AND a plugin claims `session-card-badge` matching the session
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL contain a `STATUS` titled subcard

#### Scenario: Neither git signal nor badge claim — both hide
- **WHEN** a desktop session card is rendered with `showGitInfo === false`, `session.gitWorktree` undefined, AND no plugin claims `session-card-badge`
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL NOT contain a `STATUS` titled subcard

#### Scenario: Empty PROCESS subcard is hidden
- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: Empty MEMORY subcard is hidden when no plugin claims slot
- **WHEN** a desktop session card is rendered and no plugin has registered a `session-card-memory` claim
- **THEN** no element with title text `MEMORY` SHALL appear

#### Scenario: Empty MEMORY subcard is hidden when all claims' `shouldRender` returns false
- **WHEN** a desktop session card is rendered and at least one plugin claims `session-card-memory`
- **AND** every such claim declares a `shouldRender(session)` that returns `false`
- **THEN** no element with title text `MEMORY` SHALL appear

#### Scenario: MEMORY subcard appears when at least one claim's `shouldRender` returns true
- **WHEN** at least one `session-card-memory` claim's `shouldRender(session)` returns `true` (or the claim has no `shouldRender` declared)
- **THEN** an element with title text `MEMORY` SHALL appear
- **AND** only the claims whose `shouldRender` returned `true` (or which have no `shouldRender`) SHALL be mounted inside it

#### Scenario: Empty FLOWS subcard is hidden when no plugin claims slot
- **WHEN** a desktop session card is rendered and no plugin has registered a `session-card-flows` claim
- **THEN** no element with title text `FLOWS` SHALL appear

#### Scenario: Empty FLOWS subcard is hidden when all claims' `shouldRender` returns false
- **WHEN** a desktop session card is rendered and at least one plugin claims `session-card-flows`
- **AND** every such claim declares a `shouldRender(session)` that returns `false`
- **THEN** no element with title text `FLOWS` SHALL appear

#### Scenario: FLOWS subcard appears when at least one claim's `shouldRender` returns true
- **WHEN** at least one `session-card-flows` claim's `shouldRender(session)` returns `true` (or the claim has no `shouldRender` declared)
- **THEN** an element with title text `FLOWS` SHALL appear
- **AND** only the claims whose `shouldRender` returned `true` (or which have no `shouldRender`) SHALL be mounted inside it

#### Scenario: Empty OPENSPEC subcard is hidden when handlers absent
- **WHEN** a desktop session card is rendered without `openspecChanges` or `onAttachProposal`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: OPENSPEC subcard hides when global openspec.enabled is false
- **WHEN** a desktop session card is rendered for a session whose cwd has an `openspec/` directory (`OpenSpecData.initialized === true`)
- **AND** `DashboardConfig.openspec.enabled` is `false`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: OPENSPEC subcard hides when cwd has no openspec directory
- **WHEN** a desktop session card is rendered for a session whose `OpenSpecData` is `{ initialized: false, pending: false, hasOpenspecDir: false, changes: [] }`
- **AND** `DashboardConfig.openspec.enabled` is `true`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: OPENSPEC subcard shows when openspec/ exists but openspec/changes/ does not (fresh init)
- **WHEN** a desktop session card is rendered for a session whose `OpenSpecData` is `{ initialized: false, pending: false, hasOpenspecDir: true, changes: [] }` (typical of a project where `openspec init` was run but no proposals have been authored)
- **AND** `DashboardConfig.openspec.enabled` is `true`
- **THEN** an element with title text `OPENSPEC` SHALL appear (init/attach CTA)

#### Scenario: OPENSPEC subcard shows during initial poll (pending state)
- **WHEN** a desktop session card is rendered for a session whose `OpenSpecData.pending` is `true`
- **AND** `DashboardConfig.openspec.enabled` is `true`
- **THEN** an element with title text `OPENSPEC` SHALL appear

#### Scenario: OPENSPEC subcard shows when openspec/ exists but no proposal attached
- **WHEN** a desktop session card is rendered for a session whose cwd has an `openspec/` directory (`OpenSpecData.initialized === true`)
- **AND** `session.openspecChange` is null and `openspecChanges` is empty
- **AND** `DashboardConfig.openspec.enabled` is `true`
- **THEN** an element with title text `OPENSPEC` SHALL appear (preserving the attach/init CTA affordance)

#### Scenario: Old client without initialized signal preserves current visibility
- **WHEN** a desktop session card is rendered without an `openspecData` / `openspecInitialized` prop being passed by the parent
- **AND** `DashboardConfig.openspec.enabled` is `true`
- **AND** the existing prop guard (`openspecChanges && onSendPrompt && onAttachProposal && onDetachProposal`) passes
- **THEN** the OPENSPEC subcard SHALL render (do not regress existing call sites that have not yet been migrated)

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
The mobile branch of `SessionCard.tsx` (gated by `useMobile()`) SHALL NOT use `SessionSubcard` wrappers. Mobile cards SHALL retain their flat row layout, identical to the layout prior to this change.

#### Scenario: Mobile card renders no subcard panels
- **WHEN** `useMobile()` returns true and a session card is rendered
- **THEN** no element with class token `bg-[var(--bg-surface)]` AND inset border styling characteristic of `SessionSubcard` SHALL appear inside the card
- **AND** no centered uppercase title element with content matching `OPENSPEC|WORKSPACE|PROCESS|MEMORY|FLOWS` SHALL appear

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


### Requirement: GIT subcard renders worktree pill when session is in a git worktree
When `session.gitWorktree` is set, the `GIT` subcard SHALL render an inline `worktree` pill immediately after the existing `⎇ <branch>` GitInfo line. The branch line itself SHALL be unchanged.

The pill SHALL carry class tokens consistent with other small badges: `inline-flex`, `items-center`, `px-1.5 py-px`, `rounded-full`, `text-[9px]`, `uppercase`, `tracking-wider`, `border border-[var(--border-subtle)]`, `text-[var(--text-muted)]`, `bg-[var(--bg-tertiary)]`. The pill SHALL carry `data-testid="worktree-pill"`.

The pill SHALL render text `worktree`. When `session.gitWorktree.base` is also set, the pill's `title` attribute SHALL be `created from <base>`; when absent, `git worktree`. The pill SHALL NOT appear in the `STATUS` subcard.

#### Scenario: Session in worktree shows pill inside GIT subcard
- **WHEN** a session card is rendered for a session with `gitWorktree: { mainPath: "/repo", name: "feat-x" }` and `gitBranch: "feat/dark"`
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the subcard SHALL contain the existing GitInfo line showing `⎇ feat/dark`
- **AND** the subcard SHALL contain an inline element with `data-testid="worktree-pill"` and text `worktree`
- **AND** the pill SHALL appear after the branch element in document order

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
- **THEN** the GitInfo line SHALL display `⎇ <branch>` exactly as it would for a non-worktree session (no replacement, no folder-name substitution)

#### Scenario: Mobile session card omits worktree pill
- **WHEN** the session card is rendered in mobile layout (no `SessionSubcard` wrappers)
- **THEN** the worktree pill SHALL NOT be rendered
- **AND** the mobile flat layout SHALL remain unchanged

### Requirement: cwd-gone pill on session card
The WORKSPACE subcard SHALL render a small red `cwd gone` pill (analogous to the existing `worktree` pill) when `session.cwdMissing === true`. The pill SHALL carry tooltip text "session's directory no longer exists".

#### Scenario: Pill renders for cwd-missing session
- **WHEN** the card renders a session with `cwdMissing: true`
- **THEN** the WORKSPACE subcard SHALL contain `[data-testid="cwd-gone-pill"]`

#### Scenario: Pill absent for healthy session
- **WHEN** `cwdMissing` is `undefined` or `false`
- **THEN** the pill SHALL NOT render

### Requirement: Resume button disabled when cwd missing
The session card SHALL disable its resume button and show tooltip "session's directory no longer exists" when `session.cwdMissing === true`.

#### Scenario: Resume disabled
- **WHEN** the user hovers the resume button on a cwd-missing session
- **THEN** the button SHALL be disabled
- **AND** the tooltip SHALL read "session's directory no longer exists"

### Requirement: PROCESS subcard composition
The PROCESS subcard SHALL render two stacked surfaces in order: `<SessionActivityBar />` above `<BackgroundProcessesDrawer />`. The subcard SHALL be hidden when both surfaces have nothing to render.

#### Scenario: Both surfaces empty hides subcard
- **GIVEN** the activity bar has zero in-flight bash tools AND the drawer receives zero processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL NOT render (zero DOM nodes for that section)

#### Scenario: Only activity bar non-empty
- **GIVEN** the activity bar has 1 in-flight bash tool AND the drawer receives zero processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar visible and the drawer absent

#### Scenario: Only drawer non-empty (pure-orphan)
- **GIVEN** the activity bar has zero in-flight bash tools AND the drawer receives 2 processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar absent and the drawer visible and expanded by default

#### Scenario: Both surfaces non-empty
- **GIVEN** the activity bar has 1 in-flight bash tool AND the drawer receives 2 processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar above and the drawer below
- **AND** the drawer SHALL be collapsed by default

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
The session card SHALL render an always-visible `+Session` button alongside the existing `Fork` and `Resume` controls. Unlike Fork/Resume, this button SHALL NOT be gated on `session.status === "ended"` or on the presence of `session.sessionFile` — it renders for live and ended sessions alike.

Click SHALL emit a `spawn_session` ws message with:
- `cwd` set to the parent session's `cwd`,
- `attachProposal` set to the parent session's `attachedProposal` when that field is a non-empty string (omitted otherwise),
- a fresh `requestId` (UUIDv4).

The button SHALL be `disabled` when `session.cwdMissing === true`, with tooltip text matching the existing Fork-disabled tooltip (`session's directory no longer exists`).

The button SHALL NOT carry `gitWorktreeBase` or any worktree-related metadata. Worktree-sibling spawning is covered by separate surfaces (folder `+Worktree`, per-change `⑂+`).

The `+Session` button SHALL use the green session-spawn palette (`border-green-500/30 text-green-400 hover:bg-green-500/10`), consistent with every other session-spawn control (`FolderSpawnButtons` `+ New Session`, folder-section `spawn-attached`). Session-spawn actions SHALL NOT use the purple `accent` palette, which is reserved for OpenSpec actions (Attach / Archive).

#### Scenario: Visible on live session
- **WHEN** a session card is rendered for a session with `status === "running"` (or any non-ended status)
- **THEN** the `+Session` button SHALL render
- **THEN** Fork and Resume controls SHALL be absent (existing behavior — they only show on ended sessions)

#### Scenario: Visible on ended session alongside Fork
- **WHEN** a session card is rendered for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** `+Session`, `Resume`, and `Fork` SHALL all render in the same control row

#### Scenario: Click inherits cwd and proposal
- **WHEN** the user clicks `+Session` on a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` ws message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"`, and a UUIDv4 `requestId`

#### Scenario: Click omits proposal when parent has none
- **WHEN** the user clicks `+Session` on a session whose `attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the emitted `spawn_session` payload SHALL omit the `attachProposal` key entirely (not send empty string)

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the `+Session` button SHALL render with the `disabled` attribute set
- **THEN** the tooltip SHALL read `session's directory no longer exists`
- **THEN** clicks SHALL NOT emit a `spawn_session` message

### Requirement: +Worktree button on session card
The session card SHALL render a `+Worktree` button next to `+Session`, gated by the `gitWorktreeEnabled` config flag (default true) — mirroring the folder-header `+Worktree` gate. It SHALL NOT be gated on `session.status` or `session.sessionFile`. It SHALL be hidden when the session is already a worktree session (`session.gitWorktree` set), since spawning a worktree from inside a worktree is redundant.

Click SHALL open the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`. When `session.attachedProposal` is a non-empty string, the dialog SHALL open via the proposal-aware path (pre-filled branch `os/<change>` + `attachProposal` carry-through); otherwise via the plain path (no proposal).

The button SHALL be `disabled` when `session.cwdMissing === true`, tooltip `session's directory no longer exists`. The card SHALL NOT implement its own worktree-creation, bootstrap, or `spawn_session` logic — it reuses the dialog's existing machinery.

#### Scenario: Visible next to +Session
- **WHEN** a session card renders with `gitWorktreeEnabled !== false` and a worktree handler supplied
- **THEN** the `+Worktree` button SHALL render alongside `+Session`

#### Scenario: Hidden when worktrees disabled
- **WHEN** the dashboard config has `gitWorktreeEnabled === false`
- **THEN** the `+Worktree` button SHALL NOT render (the `+Session` button is unaffected)

#### Scenario: Click with proposal opens proposal-aware dialog
- **WHEN** the user clicks `+Worktree` on a session with `attachedProposal = "add-dark-mode"`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with branch pre-filled `os/add-dark-mode` and `attachProposal` carried through

#### Scenario: Click without proposal opens plain dialog
- **WHEN** the user clicks `+Worktree` on a session with no `attachedProposal`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with no pre-filled proposal

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the `+Worktree` button SHALL render `disabled` and clicking SHALL NOT open the dialog

#### Scenario: Hidden on worktree session
- **WHEN** the session is already a worktree session (`session.gitWorktree` set)
- **THEN** the `+Worktree` button SHALL NOT render (the `+Session` button is unaffected)
