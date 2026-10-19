## MODIFIED Requirements

### Requirement: No raw colour literals on aligned action surfaces
`FolderSpawnButtons.tsx`, `DashboardSpawnButtons.tsx`, `SessionCard.tsx`, `WorktreeSpawnDialog.tsx`, `WorktreeList.tsx`, `GoalDetailClaim.tsx`, `ConfirmRenderer.tsx`, `SelectRenderer.tsx` and `CreateAutomationDialog.tsx`, and the `OpenSpecBoardView.tsx` new-session / create controls, SHALL source accent colour from `--tint-*`, `--severity-*` or `--status-*` tokens and SHALL NOT use raw Tailwind palette classes (`text|bg|border|ring|outline|divide|shadow|from|via|to-<hue>-<shade>`) or hex/rgba colour literals in class names or inline styles. The same rule SHALL apply to these files:

- the shared status pill, notice, inline action error and dialog primitives;
- `SessionActionsPanel.tsx`;
- `ProviderHealthPill.tsx`;
- `plugin-row-parts.tsx`;
- the Services shared UI file;
- the vault shared UI file;
- `OperateRequiredCallout.tsx`.

White text on `--accent-solid` (the contract's primary-button fill) is not a colour literal for this rule. Identity accents SHALL use `--tint-*`, warning/error/success/info meaning SHALL use `--severity-*`, and session status SHALL use `--status-*`.

#### Scenario: New-session tray uses tints
- **WHEN** the folder new-session tray renders in the default light theme
- **THEN** "New Session" SHALL use `--tint-green-*`, "New Worktree" SHALL use `--tint-orange-*`, and each label SHALL measure at least 4.5:1 against its composited background

#### Scenario: Worktree collision warning uses severity
- **WHEN** the worktree dialog shows the branch-collision or orphan-path warning
- **THEN** the block SHALL use `--severity-warning-*` and its text SHALL measure at least 4.5:1 in the default dark and light themes

#### Scenario: Surface files contain no palette literals
- **WHEN** the listed files are scanned for `(text|bg|border|ring|outline|divide|shadow|from|via|to)-(green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-<digits>` and `#[0-9a-fA-F]{3,8}` / `rgba(` inside `className` or `style`
- **THEN** no match SHALL be found

#### Scenario: Shared status and dialog primitives are on the list
- **WHEN** the shared status pill paints with an inline `rgba(...)` value or the dialog uses `bg-red-600`
- **THEN** the surface-file scan SHALL fail naming that file
