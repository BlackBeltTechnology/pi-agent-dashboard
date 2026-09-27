## ADDED Requirements

### Requirement: Readable text on aligned action surfaces
On the surfaces listed in `message-severity-tokens` "No raw colour literals on aligned action surfaces", section headings, field labels, help text and status words SHALL use `--text-primary` or `--text-secondary` and SHALL measure at least 4.5:1 against their composited background in the default dark and light themes, and at least 3:1 in every named theme. `--text-muted` SHALL be used only in disabled-state variants and on elements hidden from assistive technology (`aria-hidden="true"`). No text SHALL be smaller than 11 px; button, link, label and help text SHALL be at least 12 px.

#### Scenario: Worktree dialog headings readable in light theme
- **WHEN** the worktree dialog opens in the light theme
- **THEN** "Existing worktrees of this repo" and "Create a new worktree" SHALL measure at least 4.5:1 and render at least 12 px

#### Scenario: Automation help text readable
- **WHEN** the automation dialog shows next-run, file-path help or locked-name text
- **THEN** the text SHALL use `--text-secondary`, render at least 12 px and measure at least 4.5:1 in the default dark and light themes

### Requirement: Status colour on shape, not text
Session status colours (`--status-*`) SHALL be applied to status shapes or dots only. Status words (for example "Resuming…", "idle") SHALL render in `--text-secondary` next to the coloured shape.

#### Scenario: Resuming label
- **WHEN** a session card shows the resuming state
- **THEN** a status shape in `--status-working` SHALL precede the word "Resuming…", and the word SHALL use `--text-secondary`

### Requirement: Primary action recipe
Primary actions on the aligned surfaces SHALL render white text on `--accent-solid`, and when disabled SHALL render `--text-secondary` on `--bg-tertiary`. `--accent-solid` is theme-invariant (not part of the per-theme variable set), so primary actions keep the same blue under every named theme.

#### Scenario: Worktree create button
- **WHEN** the worktree dialog's "Create +Session →" button is enabled
- **THEN** it SHALL use `--accent-solid` with white text, measuring at least 4.5:1 in every theme

### Requirement: Target size and focus on aligned action surfaces
Every button on the aligned surfaces SHALL be at least 44×44 px below the `sm` breakpoint and at least 32 px tall from `sm` upward, and SHALL show a visible focus indicator (`focus-ring`) when focused by keyboard.

#### Scenario: Worktree source toggle target
- **WHEN** the worktree dialog renders at 375 px wide
- **THEN** each source toggle button SHALL be at least 44×44 px, and at 1280 px at least 32 px tall

#### Scenario: Goal controls target and focus
- **WHEN** the goal detail page renders at 375 px and the user tabs through the loop controls
- **THEN** each control SHALL be at least 44×44 px and SHALL show the focus ring when focused
