# Proposal: narrow-branch-link-hit-area

## Why

The branch link in the session card's git row is a flex item with `grow`, so the anchor stretches across all free space up to the PR / dirty pill. Clicking empty space in the row opens the forge branch page in a new tab. Users trigger this by accident when clicking near the card.

## What Changes

- The clickable branch link covers only the branch icon and branch text (including the `…` when truncated). Empty row space beside the text is not clickable and shows no branch tooltip.
- Layout is unchanged: the branch slot still takes the free space, keeps the 6-character minimum, ellipsizes long names, and keeps the full name in `title`. The PR segment and dirty / drift pill keep their position and wrapping.
- The non-link branch (no `gitBranchUrl`) is visually unchanged.
- Out of scope: the folder-header branch link (it has no `grow`, so its hit area is already the text).
- Mockup: mockups/settings-search (in this change)
- Mockup: mockups/2026-11-14-editor-tree-refresh (in this change)

The two mockups above are adopted at the user's request. They are unrelated to the branch link and are not implemented by this change; they ride along as carried design artifacts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-card-header`: requirement "Git row orders worktree first and truncates only the branch" gains a rule that the branch link's clickable area is bounded to its rendered icon + text, not the free space of the row.

## Impact

- `packages/client/src/components/session/SessionCard.tsx` (`GitInfo`): a non-clipping flex wrapper takes the branch slot's sizing; the anchor inside it is content-wide and owns the ellipsis (see design.md D1).
- Tests: vitest class-token coverage for the wrapper + anchor; Playwright geometry / hit-test coverage for the rendered row; existing narrow-card layout scenario must keep passing.
- No API, protocol, server or extension changes.

## Discipline Skills

None apply — a client-only CSS layout fix with no auth, untrusted input, perf budget, endpoint, or irreversible step.
