## MODIFIED Requirements

### Requirement: Git row orders worktree first and truncates only the branch
The git row SHALL render, in order: the `worktree` pill (when `session.gitWorktree` is set), the branch icon and branch text (link when `gitBranchUrl` is set), the PR status (when `gitPrNumber` is set), then the dirty / drift pill.

The git row SHALL render exactly when the `GitInfo` line rendered before this change: (`showGitInfo` is true OR `session.gitWorktree` is set) AND `session.gitBranch` is present AND the `git` card section is visible.

Only the branch text SHALL shrink (ellipsis, full name in `title`). The worktree pill, PR status and dirty / drift pill SHALL NOT shrink. The git row SHALL NOT overflow the card. The branch keeps at least 6 characters' width. When the pills plus that minimum do not fit on one line, the trailing pills wrap to a second git line instead of shrinking or overflowing.

The PR status SHALL reuse the PR-segment rendering previously shown in the worktree actions row: state glyph, `#N`, state word (`draft`, `open`, `merged` or `closed`) and, for an open non-draft PR, the checks summary. It links to `gitPrUrl` when known and keeps `data-testid="worktree-pr-segment"`. A legacy session carrying only `gitPrNumber` SHALL render `#N` alone. Its colours are unchanged from the worktree actions row.

The missing-folder pill SHALL NOT render in the git row.

When the branch renders as a link, the link element's box SHALL NOT extend beyond its own content: the branch icon and branch text, including the ellipsis when the text is truncated. Free row space that the branch slot leaves SHALL NOT be part of the link; a click there SHALL NOT open the branch URL and hovering it SHALL NOT show the branch `title`. The link SHALL keep its visible keyboard focus indicator. The 6-character minimum applies to the branch slot, not to the link: a branch shorter than 6 characters gives a link narrower than the slot. Bounding the link SHALL NOT change the slot's width, the branch truncation point, ellipsis, or `title`, or the position and wrapping of the trailing pills.

#### Scenario: Worktree pill leads the git row
- **WHEN** a desktop card renders a worktree session with `gitBranch: "os/feat-x"` and `gitPrNumber: 812`
- **THEN** `[data-testid="worktree-pill"]` SHALL precede the branch text in document order
- **AND** the branch text SHALL precede `[data-testid="worktree-pr-segment"]`

#### Scenario: Narrow card keeps the pills visible
- **WHEN** a worktree session with a 60-character branch name, an open PR with passing checks, and `dirtyCount: 12`, `ahead: 4`, `behind: 1` renders in a 260 px wide card
- **THEN** the branch text SHALL be ellipsized and its element SHALL be at least 6 characters wide
- **AND** the worktree pill, the PR segment and `[data-testid="git-dirty-pill"]` SHALL each be fully inside the card's content box, wrapping to a second git line if needed

#### Scenario: Non-worktree member of a multi-session folder has no git row
- **WHEN** a desktop card renders a non-worktree session whose folder group has two or more sessions
- **THEN** no git row SHALL render on that card
- **AND** the folder header SHALL keep showing the branch

#### Scenario: Worktree session without a branch yet has no git row
- **WHEN** a desktop card renders a worktree session whose `gitBranch` has not arrived yet
- **THEN** no git row and no `[data-testid="worktree-pill"]` SHALL render (unchanged from before this change)

#### Scenario: Legacy PR number only
- **WHEN** a session has `gitPrNumber: 5` and no `gitPrState`
- **THEN** the git row SHALL show `#5` with no state word and no checks summary

#### Scenario: Branch link is clickable only on its text
- **WHEN** a desktop card 420 px wide renders a session with `gitBranch: "develop"`, a `gitBranchUrl`, and `gitStatus.dirtyCount: 5`
- **THEN** the branch link element's right edge SHALL be within 1 px of the end of the rendered branch text
- **AND** `[data-testid="git-dirty-pill"]` SHALL stay right-aligned in the git row, as before this change
- **AND** the topmost element at a point midway between the branch text and the dirty pill SHALL NOT be, or be inside, any link or button below the card root
- **AND** a click at that point SHALL select the session (card click) and SHALL NOT open a new tab

#### Scenario: Long linked branch still ellipsizes inside the link
- **WHEN** a desktop card 260 px wide renders a session with a 60-character `gitBranch` and a `gitBranchUrl`
- **THEN** the branch text SHALL be ellipsized, keep at least 6 characters' width, and carry the full name in `title`
- **AND** the link element SHALL span the full width of the branch slot (within 1 px), so the text truncates no earlier than the slot allows
- **AND** the ellipsis SHALL be rendered inside the link element, so a click on it opens the branch URL

#### Scenario: Focused branch link shows its focus ring
- **WHEN** the branch link receives keyboard focus in a 260 px card with a 60-character branch
- **THEN** the link SHALL show the standard focus ring (2 px outline)
- **AND** no element between the link and the git row SHALL have a computed `overflow` other than `visible`
