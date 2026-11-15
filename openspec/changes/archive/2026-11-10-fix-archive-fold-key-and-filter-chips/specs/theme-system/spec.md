## MODIFIED Requirements

### Requirement: Card pill surfaces paint colour only through tokens

The folder-card and session-card pill surfaces SHALL source every colour from theme tokens — never a raw Tailwind palette colour class (the class shape defined by "Raw palette classes SHALL NOT be added"), a hex literal, an `rgba(` literal, or a `var(--token, <literal>)` fallback literal. The surfaces are:

- `FolderActionBanner.tsx`, `WorktreeInitButton.tsx`, `WorktreeInitChip.tsx`, `WorktreeInitStack.tsx`;
- the shared `SlotPill.tsx`, `FolderAutomationSection.tsx`, `FolderGoalsSection.tsx`, `FolderMcpSection.tsx`, `FolderOpenSpecSection.tsx`;
- `OpenSpecActivityBadge.tsx`, `openspec-helpers.tsx`, `OpenSpecGroupPills.tsx`, `FlowActivityBadge.tsx`;
- in `SessionList.tsx`, only three sites: the `ToggleButton` chips (the Sessions/Folders scope toggles and the funnel `Archived` / `Hidden` toggles), the add-to-workspace menu node and the folder pinned indicator.

Readable text on these surfaces SHALL NOT paint `--text-muted` (permitted only on disabled variants and `aria-hidden="true"` elements). Control labels SHALL render at 12 px or larger; all other text at 11 px or larger.

#### Scenario: Pill surface files contain no colour literals
- **WHEN** the string and template literals of the listed files are scanned with the `rawPalette` class pattern, `#[0-9a-fA-F]{3,8}`, `rgba(` and `var(--…, <literal>)`
- **AND** in `SessionList.tsx` only the literals inside the `ToggleButton` component, the `renderAddToWorkspaceButton` function and the element carrying `data-testid` prefix `folder-pinned-indicator-` are scanned
- **THEN** no match SHALL be found

#### Scenario: Readable metadata replaces muted text
- **WHEN** an OpenSpec activity row shows a task count `(4/12)`, the worktree init stack shows elapsed time and a last output line, or an unpressed toggle chip renders its label
- **THEN** that text SHALL paint `--text-secondary` and measure at least 4.5:1 in base dark and base light

#### Scenario: Session-card pills read in the light theme
- **GIVEN** the base light theme
- **WHEN** an OpenSpec activity row for each phase, the artifact letters, a running / success / error / aborted flow badge with its Abort control, and pressed and unpressed toggle chips render
- **THEN** every text node SHALL measure at least 4.5:1 and every glyph at least 3:1 against its composited background
