## ADDED Requirements

### Requirement: Card pill surfaces paint colour only through tokens

The folder-card and session-card pill surfaces SHALL source every colour from theme tokens — never a raw Tailwind palette colour class (the class shape defined by "Raw palette classes SHALL NOT be added"), a hex literal, an `rgba(` literal, or a `var(--token, <literal>)` fallback literal. The surfaces are:

- `FolderActionBanner.tsx`, `WorktreeInitButton.tsx`, `WorktreeInitChip.tsx`, `WorktreeInitStack.tsx`;
- the shared `SlotPill.tsx`, `FolderAutomationSection.tsx`, `FolderGoalsSection.tsx`, `FolderMcpSection.tsx`, `FolderOpenSpecSection.tsx`;
- `OpenSpecActivityBadge.tsx`, `openspec-helpers.tsx`, `OpenSpecGroupPills.tsx`, `FlowActivityBadge.tsx`;
- in `SessionList.tsx`, only four sites: the sidebar filter chip, the include-archive chip, the add-to-workspace menu node and the folder pinned indicator.

Readable text on these surfaces SHALL NOT paint `--text-muted` (permitted only on disabled variants and `aria-hidden="true"` elements). Control labels SHALL render at 12 px or larger; all other text at 11 px or larger.

#### Scenario: Pill surface files contain no colour literals
- **WHEN** the string and template literals of the listed files are scanned with the `rawPalette` class pattern, `#[0-9a-fA-F]{3,8}`, `rgba(` and `var(--…, <literal>)`
- **AND** in `SessionList.tsx` only the literals inside the `ToggleButton` component, the `renderAddToWorkspaceButton` function, the element carrying `data-testid="search-include-archive"` and the element carrying `data-testid` prefix `folder-pinned-indicator-` are scanned
- **THEN** no match SHALL be found

#### Scenario: Readable metadata replaces muted text
- **WHEN** an OpenSpec activity row shows a task count `(4/12)`, the worktree init stack shows elapsed time and a last output line, or an unpressed toggle chip renders its label
- **THEN** that text SHALL paint `--text-secondary` and measure at least 4.5:1 in base dark and base light

#### Scenario: Session-card pills read in the light theme
- **GIVEN** the base light theme
- **WHEN** an OpenSpec activity row for each phase, the artifact letters, a running / success / error / aborted flow badge with its Abort control, and pressed and unpressed toggle chips render
- **THEN** every text node SHALL measure at least 4.5:1 and every glyph at least 3:1 against its composited background

### Requirement: Card pill colour roles

On the card pill surfaces, colour SHALL follow these roles:

- Coloured status text and glyphs on a neutral surface SHALL use the on-surface ramp `--accent-<hue>-text`. OpenSpec phases fold as explore / continue / ff → blue, new / sync-specs / onboard → purple, apply → yellow, verify / archive → green. Flow statuses map running → blue, success → green, error → red, aborted → orange. Artifact letters map done → green, ready → yellow, any other status → `--text-secondary`.
- A pressed toggle chip (`aria-pressed="true"`, or the active group pill) SHALL be a selected chip per "Accent tokens are declared for every theme": `--text-primary` on `--accent-soft`, bordered `--accent`. An unpressed chip's label SHALL use `--text-secondary`.
- The flow Abort control is destructive and SHALL paint the `--tint-red-*` identity triple. A failed init-stack row expresses severity and SHALL paint `--severity-error-*`. The add-to-workspace menu node and the init-stack Dismiss SHALL be neutral controls: `--text-primary` label, `--border-secondary` outline, no hue.
- Status glyphs SHALL be MDI icons, not text symbols (`✓`, `✕`, `↻`).

#### Scenario: Pressed chip is a selected chip
- **WHEN** an OpenSpec group pill is active
- **THEN** its text, background and border SHALL resolve to `--text-primary`, `--accent-soft` and `--accent`
- **AND** its text SHALL measure at least as high as the unpressed chips' text in the same group

#### Scenario: Severity and destruction keep their families
- **WHEN** a flow badge shows Abort and the init stack shows a failed row
- **THEN** Abort SHALL resolve to `--tint-red-{fg,bg,border}` and the failed row to `--severity-error-{bg,fg}`

### Requirement: Raw palette classes SHALL NOT be added

The theme-token guard SHALL carry a fourth ratchet arm, `rawPalette`, alongside the fallback-form, undeclared-token and accent-as-text arms. It scans `.ts` / `.tsx` under the same source roots, excluding test files the same way, and counts occurrences per `<file>::<hue>` site. A raw palette class is a colour utility prefix — `text`, `bg`, `border` (including side forms such as `border-l`), `ring` (including `ring-offset`), `outline`, `divide`, `fill`, `stroke`, `from`, `via`, `to`, `placeholder`, `decoration`, `caret`, `accent`, `shadow` — followed by a Tailwind palette hue and a numeric shade, optionally with variant prefixes and an opacity suffix.

The arm SHALL be a ratchet, not a sweep. Its baseline SHALL be established once, after the card pill surfaces are migrated, and enumerate every remaining site. The guard SHALL fail on a site absent from the baseline or a baselined site whose count grows; repaired sites SHALL be reported as shrinkable; the baseline writer SHALL refuse to grow the arm. A failure SHALL name the arm, file and hue, and point to the replacement token families.

#### Scenario: A new raw palette class fails
- **WHEN** a component under the scanned roots adds `text-amber-400` in a file with no `::amber` baseline entry
- **THEN** the guard SHALL fail, naming the `rawPalette` arm, the file and `amber`

#### Scenario: Side and offset forms are caught
- **WHEN** a component adds `border-l-blue-400` or `ring-offset-red-500` at a site absent from the baseline
- **THEN** the guard SHALL fail

#### Scenario: A baselined site cannot grow
- **GIVEN** a file baselined with N occurrences of the `blue` hue
- **WHEN** an (N+1)th `blue` palette class is added to that file
- **THEN** the guard SHALL fail

#### Scenario: The pre-existing palette classes do not fail the build
- **GIVEN** the baseline established after the card pill migration
- **WHEN** the guard runs with no source change
- **THEN** it SHALL pass

#### Scenario: Migrated card pill files are not baselined
- **WHEN** the established baseline is inspected
- **THEN** it SHALL contain no entry for any file listed in "Card pill surfaces paint colour only through tokens" other than `SessionList.tsx`, whose non-pill sites stay baselined

#### Scenario: Token paints and non-colour utilities are not flagged
- **WHEN** a component uses `text-[var(--accent-red-text)]`, `bg-[var(--tint-blue-bg)]`, `text-white`, `text-xs` or `border-2`
- **THEN** the `rawPalette` arm SHALL NOT record it

#### Scenario: Test files are excluded
- **WHEN** a `*.test.tsx` file asserts on `text-green-500`
- **THEN** the `rawPalette` arm SHALL NOT record it

#### Scenario: The baseline only shrinks
- **WHEN** a baselined site is migrated to tokens and the baseline is rewritten with `--write`
- **THEN** its entry SHALL be removed
- **AND** reintroducing the raw palette class at that site SHALL fail
