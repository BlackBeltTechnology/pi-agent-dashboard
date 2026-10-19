## ADDED Requirements

### Requirement: Menu items carry an optional semantic tone

Each session menu item MAY carry one tone from the shared vocabulary `go | create | caution | danger`. An item without a tone is neutral.

**Rendering:**
- A toned, enabled item SHALL colour its icon with the tone's foreground token: go = `--tint-green-fg`, create = `--tint-blue-fg`, caution = `--tint-orange-fg`, danger = `--tint-red-fg`.
- The item's label SHALL keep the neutral item text colour. Tone SHALL NOT be the only carrier of meaning: the label alone SHALL identify the action.
- A `danger` item SHALL use `--tint-red-bg` as its hover and keyboard-focus background instead of the neutral hover background.
- A disabled item SHALL render without its tone colour and without the danger hover, so it does not look actionable.
- Neutral items SHALL render exactly as before this change.
- Each toned item SHALL expose its tone as `data-tone="<tone>"`. Neutral items SHALL carry no `data-tone`.
- In every built-in palette, in both dark and light mode, each tone's icon colour SHALL reach at least 3:1 contrast against the menu surface (WCAG 1.4.11).

**Host item tones:**

| Tone | Items |
|---|---|
| go | Resume, New session, Verify, Merge |
| create | Fork, New change…, Propose…, Open PR (creates a pull request) |
| caution | New worktree session, Commit N changes…, Archive anyway… |
| danger | Stop, Exit pi session, Close worktree… |

All other host items are neutral, including View PR #N, which only opens an existing pull request.

**Plugin items:** `ui:action-list` items rendered in the `PLUGINS` group SHALL honour their optional `tone` with the same rendering rules (see `plugin-ui-primitive-registry`). React claim output is not toned by the host.

#### Scenario: Destructive item shows a red icon and red hover
- **WHEN** the menu of alive session `s1` opens and the pointer hovers **Exit pi session**
- **THEN** that item SHALL carry `data-tone="danger"`
- **AND** its icon's computed colour SHALL equal the resolved `--tint-red-fg`
- **AND** its label's computed colour SHALL equal that of a neutral item's label
- **AND** its hover background SHALL equal the resolved `--tint-red-bg`

#### Scenario: Neutral item is unchanged
- **WHEN** the menu of session `s1` opens
- **THEN** **Rename…** SHALL carry no `data-tone`
- **AND** its icon's computed colour SHALL equal its label's computed colour

#### Scenario: Disabled toned item drops its colour
- **WHEN** session `s1` has `cwdMissing === true` and its menu opens
- **THEN** **New session** SHALL render `aria-disabled="true"`
- **AND** its icon SHALL NOT use `--tint-green-fg`

#### Scenario: Creating a PR is a create action, viewing one is neutral
- **WHEN** worktree session `s1` has no PR yet and its menu opens
- **THEN** **Open PR** SHALL carry `data-tone="create"`
- **AND WHEN** `s1` has PR #12 with a known URL
- **THEN** **View PR #12** SHALL carry no `data-tone`

#### Scenario: Plugin action-list item honours its tone
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1` with one action `{ label: "Stop recording", tone: "danger" }`
- **THEN** that action's `menuitem` in `s1`'s `PLUGINS` group SHALL carry `data-tone="danger"` and a `--tint-red-fg` icon

#### Scenario: Tone icon colours meet non-text contrast in every palette
- **WHEN** each built-in palette is applied in dark and light mode
- **THEN** each of `--tint-green-fg`, `--tint-blue-fg`, `--tint-orange-fg` and `--tint-red-fg` SHALL have a contrast ratio of at least 3:1 against the menu surface

### Requirement: NEXT and the lifecycle row use state colour

The `NEXT` item's primary emphasis SHALL use the blue tint triple: background `--tint-blue-bg`, text and icon `--tint-blue-fg`, border `--tint-blue-border`. When the NEXT item is disabled (session working), it SHALL keep the disabled rendering and SHALL NOT use the tint.

Each segment of the `OPENSPEC` lifecycle artifact row SHALL show a state bar above its letter. The bar and the letter SHALL take the same state colour and glyph as the matching segment of the card's lifecycle bar, so the two surfaces never disagree:
- done: `--status-idle`, glyph `✓`;
- current: `--status-working`, glyph `▸`;
- pending: `--text-muted`;
- skipped: the done colour, glyph `–`.

The segment SHALL also expose its state as `data-state`, as today. State SHALL remain readable without colour, through the glyph and the segment's accessible name (`<label>, <state>`).

#### Scenario: NEXT uses the blue tint
- **WHEN** session `s1` is attached to an `IMPLEMENTING` change and is idle
- **THEN** the NEXT item **Apply** SHALL render with background `--tint-blue-bg` and border `--tint-blue-border`

#### Scenario: Working session's NEXT is not tinted
- **WHEN** session `s1` is streaming
- **THEN** the NEXT item SHALL render `aria-disabled="true"` without the `--tint-blue-bg` background

#### Scenario: Lifecycle bars reflect state
- **WHEN** the attached change has Proposal and Design done, Specs current, and Tasks and Archive pending
- **THEN** each menu segment's bar colour SHALL equal the computed colour of the same segment on the card's lifecycle bar (P and D in `--status-idle`, S in `--status-working`, T and A in `--text-muted`)
- **AND** each segment's accessible name SHALL include its state word
