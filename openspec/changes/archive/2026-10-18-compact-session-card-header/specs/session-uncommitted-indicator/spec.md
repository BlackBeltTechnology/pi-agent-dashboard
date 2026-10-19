## MODIFIED Requirements

### Requirement: Session card surfaces uncommitted working-tree state

The session card SHALL display the count of uncommitted files (staged + unstaged + untracked) and the branch's ahead/behind drift versus its upstream, sourced from `DashboardSession.gitStatus`. The indicator SHALL be hidden when the working tree is clean AND the branch is in sync.

On the desktop session card the indicator SHALL render as the last element of the header git row and SHALL NOT shrink. It SHALL be a filled capsule using the `--severity-warning-bg` / `--severity-warning-fg` / `--severity-warning-border` triple, not an undefined token with a raw fallback. The count is a warning meaning, and a foreground token renders only on its matching fill. Its text, including the ahead / behind chips, SHALL reach at least 4.5:1 contrast against its background in both the base dark and base light themes. The same component renders on the folder header, so the folder header gets the same colours and the same contrast floor.

#### Scenario: Dirty working tree shows a count pill
- WHEN a session's cwd has 5 uncommitted files
- THEN the header git row shows an orange `● 5` pill whose tooltip contains the count 5
- AND the pill is a button that opens the commit dialog

#### Scenario: Ahead/behind drift is shown when non-zero
- WHEN the branch is 2 commits ahead and 1 behind upstream
- THEN the card shows `↑2` and `↓1` chips
- AND when ahead and behind are both 0 no drift chips render

#### Scenario: Clean and in-sync hides the indicator
- WHEN the working tree is clean AND ahead = 0 AND behind = 0
- THEN no dirty pill and no drift chips are rendered

#### Scenario: Legacy or inconclusive probe renders nothing
- WHEN `gitStatus` is absent on the session
- THEN the indicator renders nothing and no error is shown

#### Scenario: Pill meets AA contrast in both base themes
- WHEN the dirty pill renders on a session card and on a folder header, in the base light theme and in the base dark theme
- THEN the computed contrast of the dirty-count text and of each ahead / behind chip against its composited background is at least 4.5:1 in every case
