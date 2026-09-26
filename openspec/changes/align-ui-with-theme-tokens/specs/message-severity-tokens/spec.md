## ADDED Requirements

### Requirement: Identity tint triples with severity aliases
The client SHALL define in `index.css`, alongside the severity triples, `--tint-<hue>-{bg,fg,border}` for each of `green | orange | blue | purple | red`, derived from `--accent-<hue>` with the same formula as the severity triples (`bg` 10% into `--bg-tertiary`, `fg` 46% toward `--text-primary`, `border` 40% into transparent). `--severity-success-*`, `--severity-warning-*`, `--severity-info-*` and `--severity-error-*` SHALL resolve through `--tint-green-*`, `--tint-orange-*`, `--tint-blue-*` and `--tint-red-*` respectively, with resolved values unchanged. Tints SHALL express identity (pi, worktree, fork, goals, destructive) and SHALL NOT be used to express severity.

#### Scenario: Severity values unchanged
- **WHEN** the resolved values of every `--severity-{success,warning,info,error}-*` token are compared before and after this change in every theme, light and dark
- **THEN** they SHALL be identical

#### Scenario: Tints meet the severity contrast gate
- **WHEN** each `--tint-<hue>-fg` is composited over `--tint-<hue>-bg` in every theme, light and dark
- **THEN** the ratio SHALL satisfy the same gate as the derived severity triples

### Requirement: No raw colour literals on aligned action surfaces
`FolderSpawnButtons.tsx`, `SessionCard.tsx`, `WorktreeSpawnDialog.tsx`, `WorktreeList.tsx`, `GoalDetailClaim.tsx`, `ConfirmRenderer.tsx`, `SelectRenderer.tsx` and `CreateAutomationDialog.tsx` SHALL source accent colour from `--tint-*`, `--severity-*` or `--status-*` tokens and SHALL NOT use raw Tailwind palette classes (`text|bg|border-<hue>-<shade>`) or hex/rgba colour literals in class names or inline styles. Identity accents SHALL use `--tint-*`, warning/error/success/info meaning SHALL use `--severity-*`, and session status SHALL use `--status-*`.

#### Scenario: Spawn tray uses tints
- **WHEN** the folder spawn tray renders in the light theme
- **THEN** "New Session" SHALL use `--tint-green-*`, "New Worktree" SHALL use `--tint-orange-*`, and each label SHALL measure at least 4.5:1 against its composited background

#### Scenario: Worktree collision warning uses severity
- **WHEN** the worktree dialog shows the branch-collision or orphan-path warning
- **THEN** the block SHALL use `--severity-warning-*` and its text SHALL measure at least 4.5:1 in dark and light

#### Scenario: Surface files contain no palette literals
- **WHEN** the listed files are scanned for `(text|bg|border)-(green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-<digits>` and `#[0-9a-fA-F]{3,8}` / `rgba(` inside `className` or `style`
- **THEN** no match SHALL be found
