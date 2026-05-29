## MODIFIED Requirements

### Requirement: Desktop session card body groups sections into six subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `GIT`, `JJ`, `PROCESS`, `FLOWS`, `MEMORY`. The header zone (status dot, name + rename, time, hide/close icons, model + thinking-level + Fork button, activity row with context bar + cost) SHALL remain outside any subcard, above the first subcard. The footer plugin slot `SessionCardActionBarSlot` SHALL remain outside any subcard, below the last subcard.

The previous `WORKSPACE` subcard SHALL be removed and replaced by two sibling subcards `GIT` and `JJ` rendered in that order. The `GIT` subcard hosts git branch / PR / worktree information and the new `WorktreeActionsMenu` row when applicable. The `JJ` subcard hosts jj-specific badge contributions and the `workspace-action-bar` slot.

#### Scenario: All six subcard titles appear in order when populated
- **WHEN** a desktop session card is rendered with content for every subcard
- **THEN** the rendered DOM SHALL contain centered title elements `OPENSPEC`, `GIT`, `JJ`, `PROCESS`, `FLOWS`, `MEMORY` in that document order

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
| JJ | A plugin contributes to the `session-card-badge` slot whose `shouldRender` (if declared) returns `true` for the session OR a plugin contributes to `workspace-action-bar` whose `shouldRender` returns `true` |
| PROCESS | `processes && processes.length > 0 && onKillProcess` |
| FLOWS | A plugin contributes to the `session-card-flows` slot whose `shouldRender` (if declared) returns `true` for the session. Claims without a `shouldRender` declaration are treated as always rendering. |
| MEMORY | A plugin contributes to the `session-card-memory` slot whose `shouldRender` (if declared) returns `true` for the session. Claims without a `shouldRender` declaration are treated as always rendering. |

The GIT subcard's predicate is strictly git-scoped: it SHALL NOT consider plugin slot claims. The JJ subcard's predicate is strictly plugin-scoped (the jj-plugin claims `session-card-badge` and `workspace-action-bar`): it SHALL NOT consider `showGitInfo` or `session.gitWorktree`. Both subcards SHALL render independently — in a colocated git+jj repo, both subcards SHALL appear; in a pure-git repo only `GIT`; in a pure-jj repo only `JJ`; in neither, both hide.

#### Scenario: Colocated git+jj repo shows both GIT and JJ subcards
- **WHEN** a desktop session card is rendered with `showGitInfo === true` AND a plugin claims `session-card-badge` matching the session
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL contain a `JJ` titled subcard
- **AND** `GIT` SHALL appear before `JJ` in document order

#### Scenario: Pure-git repo shows only GIT subcard
- **WHEN** a desktop session card is rendered with `showGitInfo === true` AND no plugin claims `session-card-badge` or `workspace-action-bar` for the session
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL NOT contain a `JJ` titled subcard

#### Scenario: Pure-jj repo shows only JJ subcard
- **WHEN** a desktop session card is rendered with `showGitInfo === false` AND `session.gitWorktree` is undefined AND a plugin claims `workspace-action-bar` matching the session
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL contain a `JJ` titled subcard

#### Scenario: Neither git nor jj — both hide
- **WHEN** a desktop session card is rendered with `showGitInfo === false`, `session.gitWorktree` undefined, AND no plugin claims `session-card-badge` or `workspace-action-bar`
- **THEN** the rendered DOM SHALL NOT contain a `GIT` titled subcard
- **AND** the rendered DOM SHALL NOT contain a `JJ` titled subcard

### Requirement: New plugin slot `workspace-action-bar` is reserved and consumed by JJ subcard
The plugin slot identifier `workspace-action-bar` SHALL continue to exist in `SLOT_DEFINITIONS` with multiplicity `many` and payload tier `react-only`. The slot's claims SHALL be rendered inside the `JJ` subcard (previously the `WORKSPACE` subcard). When no plugin claims the slot AND no plugin claims `session-card-badge`, the `JJ` subcard hides.

A matching consumer component `WorkspaceActionBarSlot({ session })` SHALL remain exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` unchanged in signature.

#### Scenario: Slot definition still exists
- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "workspace-action-bar"` and `multiplicity: "many"`

#### Scenario: Plugin contribution renders inside JJ subcard
- **WHEN** a plugin registers a `workspace-action-bar` claim that returns a non-empty React node
- **AND** a desktop session card is rendered for the matching session
- **THEN** the rendered DOM SHALL contain a `JJ` titled subcard
- **AND** the plugin's contribution SHALL appear inside that subcard's body
- **AND** the contribution SHALL NOT appear inside a `GIT` titled subcard

### Requirement: GIT subcard renders worktree pill when session is in a git worktree
When `session.gitWorktree` is set, the `GIT` subcard SHALL render an inline `worktree` pill immediately after the existing `⎇ <branch>` GitInfo line. The branch line itself SHALL be unchanged.

The pill SHALL carry class tokens consistent with other small badges: `inline-flex`, `items-center`, `px-1.5 py-px`, `rounded-full`, `text-[9px]`, `uppercase`, `tracking-wider`, `border border-[var(--border-subtle)]`, `text-[var(--text-muted)]`, `bg-[var(--bg-tertiary)]`. The pill SHALL carry `data-testid="worktree-pill"`.

The pill SHALL render text `worktree`. When `session.gitWorktree.base` is also set, the pill's `title` attribute SHALL be `created from <base>`; when absent, `git worktree`. The pill SHALL NOT appear in the `JJ` subcard.

#### Scenario: Session in worktree shows pill inside GIT subcard
- **WHEN** a session card is rendered for a session with `gitWorktree: { mainPath: "/repo", name: "feat-x" }` and `gitBranch: "feat/dark"`
- **THEN** the rendered DOM SHALL contain a `GIT` titled subcard
- **AND** the subcard SHALL contain the existing GitInfo line showing `⎇ feat/dark`
- **AND** the subcard SHALL contain an inline element with `data-testid="worktree-pill"` and text `worktree`
- **AND** the pill SHALL appear after the branch element in document order

#### Scenario: Worktree pill does NOT appear in JJ subcard
- **WHEN** a session card is rendered for a session with `gitWorktree` set AND a plugin claims `workspace-action-bar`
- **THEN** the `JJ` titled subcard SHALL NOT contain any element with `data-testid="worktree-pill"`
