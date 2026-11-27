## MODIFIED Requirements

### Requirement: Readable text on aligned action surfaces
On the surfaces listed in `message-severity-tokens` "No raw colour literals on aligned action surfaces", section headings, field labels, help text and status words SHALL use `--text-primary` or `--text-secondary` and SHALL measure at least 4.5:1 against their composited background in the default dark and light themes, and at least 3:1 in every named theme. `--text-muted` SHALL be used only in disabled-state variants and on elements hidden from assistive technology (`aria-hidden="true"`). No text SHALL be smaller than 11 px; button, link, label and help text SHALL be at least 12 px.

#### Scenario: Worktree dialog headings readable in light theme
- **WHEN** the worktree dialog opens in the light theme
- **THEN** "Existing worktrees of this repo" and "Create a new worktree" SHALL measure at least 4.5:1 and render at least 12 px

#### Scenario: Automation help text readable
- **WHEN** the automation editor shows next-run, file-path help or its save-bar write-path caption
- **THEN** the text SHALL use `--text-secondary`, render at least 12 px and measure at least 4.5:1 in the default dark and light themes
