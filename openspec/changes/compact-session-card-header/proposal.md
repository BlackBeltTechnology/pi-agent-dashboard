## Why

Once `add-session-actions-flyout` removes the action chips, the desktop session card's header still spreads "what is this session doing / where / with what" across two lines plus a separate GIT subcard. The branch and worktree identity sit two blocks below the title, and the missing-folder pill is only visible when the session happens to be in git. The card is taller than it needs to be, and its identity is harder to scan than it should be.

## What Changes

The header zone of the **desktop** session card is reordered into four rows. Rows 2–4 start at the session-name edge, which is the status chip width plus the gap (24 px today):

1. **Title row**: status chip, name, then the missing-folder pill, time, and the existing `⋮` / Archive / Exit controls. The `⋮` trigger comes from the dependency.
2. **Status row**: the existing `ActivityIndicator` (Resuming, ended reason, Needs you, Retry N, current tool, Thinking…, Idle) with `HostPressureIndicator` right-aligned. The row is omitted when both render nothing.
3. **Git row**: the `GitInfo` line lifted out of the GIT subcard. The `worktree` pill comes first, then `⎇ branch` (the only element that truncates), then the PR status (state glyph + `#N` + state word + checks), then the dirty / ahead / behind pill. Render gate unchanged: `showGitInfo || session.gitWorktree`, and `gitBranch` present.
4. **Meta row**: model, shown as the model id with the full `provider/id` in its `title`, followed by the existing Moved / Origin-device / Driver chips, then the context usage bar and cost, right-aligned.

The existing OpenSpec activity badge line, tag strip and pi-below-floor warning keep their order after these rows. Empty rows are not rendered.

Further changes:
- **The GIT subcard is removed.** After `add-session-actions-flyout` it holds only the `GitInfo` line, which now lives in the header. The subcard stack becomes `OPENSPEC`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`.
- **Missing-folder pill**: moves from `GitInfo` to the title row and renders whenever `session.cwdMissing === true`, independent of git. This fixes today's gap: sessions outside git, and non-worktree members of a multi-session folder, show no pill at all. The label changes from `cwd gone` to `folder missing`; the i18n key `common.cwdGone` and `data-testid="cwd-gone-pill"` are kept. Styling matches the other title-row pills (11 px, normal case).
- **The `git` card-section toggle** keeps its id and now governs the git row. Its description text is updated.
- **Dirty pill contrast fix**: `GitDirtyPill` uses the undefined `--status-warning` token, which falls back to `#d97706`. That measures 3.19:1 on the light card, below the 4.5:1 WCAG AA minimum for 10 px text. It becomes a filled `--severity-warning-*` capsule (6.13:1 light, 7.82:1 dark). This also affects the folder header, which shares the component.
- **The PR status moves into the git row**: `PrSegment`'s glyph / number / state / checks rendering, reused unchanged. `add-session-actions-flyout` removed it from the card along with the worktree actions row.
- **Unchanged:** the mobile session card's rendered output, the composer strip, the folder header layout, every subcard's content, and the session actions menu. The folder header's dirty pill picks up the filled warning capsule described above.
- Mockup: mockups/session-card-git-identity-row (in this change)

## Dependencies

- **Depends on `add-session-actions-flyout`** (under implementation, not modified by this change). This change's deltas are written against that change's end state of `session-card-subcards` and `session-card-section-visibility`: no line-2 action chips, no `WorktreeActionsMenu` row, a `⋮` trigger in the title row. Two requirements are modified by both changes (`session-card-section-visibility` › "Toggleable section set" and "Inline legend menu"), and this change removes the flyout's version of the six-subcard requirement. That change MUST be archived into `openspec/specs/` before this change archives, and the shared copies are re-diffed against its archived text first. Implementation starts from its merged result on `develop`. If it is not merged yet, the worktree branches from `os/add-session-actions-flyout`.

### Coordination
- `extract-git-as-plugin` (proposal-only draft, not started) plans to move `GitInfo` into the `session-card-badge` slot. After this change `GitInfo` is a header row, so a future extraction needs a header-row slot rather than the STATUS badge slot. That change is not modified here.

## Capabilities

### New Capabilities
- `session-card-header`: layout contract for the desktop session card's header zone. Covers the four-row order, the shared text column, status-row contents and omission, git-row element order and truncation, model-id label, and missing-folder pill placement and label.

### Modified Capabilities
- `session-card-subcards`: the GIT subcard is removed, so the subcard order loses `GIT`. The worktree pill now renders in the header git row, leading. The cwd-gone pill moves to the title row with the new label and a git-independent gate.
- `session-card-section-visibility`: the `git` section id now governs the header git row instead of a subcard. Scenarios in "Visibility resolution order", "Server-side persistence and sync" and "Inline legend menu" that name the GIT subcard now name the git row.
- `session-uncommitted-indicator`: the dirty / drift pill renders in the header git row instead of the GIT subcard. Its colours meet WCAG AA in both base themes.

## Discipline Skills

- `review-code`: non-trivial client change. Run before commit once tests pass.
- No `security-hardening`, `performance-optimization`, `observability-instrumentation` or `doubt-driven-review` trigger in the implementation itself. No auth, untrusted input, latency budget, new endpoint or irreversible step is involved; planning-stage doubt review is done by `plan-proposal`.

## Impact

- **Code:** `packages/client/src/components/session/SessionCard.tsx` (header zone, `GitInfo`, `WorktreePill` order, `GitSubcard` removal, ActivityIndicator placement), `packages/client/src/components/folder/CwdGonePill.tsx` (style + label), `packages/client/src/components/worktree/GitDirtyPill.tsx` (tokens), `packages/client/src/components/worktree/WorktreeActionsMenu.tsx` (export `PrSegment` for reuse), `packages/client/src/lib/session/card-section-meta.ts` (git description), i18n en/hu/zh-CN strings for `common.cwdGone` and `cardSections.descGit`.
- **Tests:** SessionCard unit tests that look for the worktree pill, dirty pill or cwd-gone pill inside a `GIT` subcard; card-sections tests; e2e specs that query the GIT subcard.
- **No server, protocol, or persistence changes.** No migration. Rollback = revert the client commit.
