## ADDED Requirements

### Requirement: Menu items carry an optional semantic tone

Each session menu item MAY carry one tone from the shared vocabulary `UiTone = go | create | caution | danger`. An item without a tone is neutral.

**Rendering:**
- An enabled item with a tone SHALL colour its icon with the tone's text-role accent token: go = `--accent-green-text`, create = `--accent-blue-text`, caution = `--accent-orange-text`, danger = `--accent-red-text`.
- The item's label SHALL keep the same colour as a neutral item's label. Tone SHALL NOT be the only carrier of meaning: the label alone SHALL identify the action (WCAG 1.4.1).
- An enabled `danger` item, while hovered or keyboard-focused, SHALL render on `--tint-red-bg` with both its icon and its label in `--accent-red-text`, replacing the neutral hover/focus styling. Pinning the label colour keeps the overlay contrast independent of the neutral label colour.
- A disabled item SHALL render without its tone colour, without the danger background and without any hover highlight, exactly like a neutral disabled item, so it does not look actionable.
- Every item with a valid tone SHALL expose `data-action-tone="<tone>"`, whether enabled or disabled. Neutral items SHALL carry no `data-action-tone`.
- **Invalid values:** any `tone` value that is not exactly one of the four tone strings SHALL be treated as neutral: no colour, no danger styling, no `data-action-tone`. This includes inherited object keys such as `constructor`, `toString` and `__proto__`, and non-string values.
- Neutral items SHALL render exactly as they would without this requirement.
- **Contrast:** in every built-in palette, in dark and light mode, each tone's icon colour SHALL reach at least 3:1 (WCAG 1.4.11):
  - against the menu surface;
  - for `danger`, also against `--tint-red-bg`.

  The danger row's hover/focus label (`--accent-red-text`) SHALL reach at least 4.5:1 against `--tint-red-bg` (WCAG 1.4.3).

**Host item tones:**

| Tone | Items |
|---|---|
| go | Resume, New session, Verify, Merge |
| create | Fork, New change…, Propose…, Open PR (creates a pull request) |
| caution | New worktree session, Commit N changes…, Archive anyway… |
| danger | Exit pi session, Close worktree… |

All other host items are neutral, including View PR #N (it only opens an existing pull request) and Archive session and Push, which change state but discard nothing. `danger` is reserved for actions that end a process or discard work.

**NEXT takes precedence over tone:** the item placed in `NEXT`, whether enabled or disabled, carries no tone and no `data-action-tone`. When enabled, it renders with the NEXT emphasis (see "NEXT and the lifecycle row use state colour"). When the same action also appears un-emphasised in its home group, which happens only for the OpenSpec primary when Merge wins NEXT, that copy keeps its tone.

React claim output in the `PLUGINS` group is not toned by the host.

#### Scenario: Destructive item shows a red icon and red hover
- **WHEN** the menu of alive session `s1` opens and the pointer hovers **Exit pi session**
- **THEN** that item SHALL carry `data-action-tone="danger"`
- **AND** its icon's computed colour SHALL equal the resolved `--accent-red-text`
- **AND** its label's computed colour SHALL equal that of a neutral item's label
- **AND** while hovered, its background SHALL equal the resolved `--tint-red-bg` and its label colour SHALL equal the resolved `--accent-red-text`

#### Scenario: Keyboard focus on a destructive item uses the red background
- **WHEN** keyboard focus moves to **Close worktree…** with ArrowDown
- **THEN** its background SHALL equal the resolved `--tint-red-bg` and its label colour SHALL equal the resolved `--accent-red-text`

#### Scenario: Neutral item is unchanged
- **WHEN** the menu of session `s1` opens
- **THEN** **Rename…** SHALL carry no `data-action-tone`
- **AND** its icon's computed colour SHALL equal its label's computed colour

#### Scenario: Disabled toned item drops its colour but keeps its tone hook
- **WHEN** session `s1` has `cwdMissing === true` and its menu opens
- **THEN** **New session** SHALL render `aria-disabled="true"` and carry `data-action-tone="go"`
- **AND** its icon SHALL NOT be coloured `--accent-green-text`

#### Scenario: Creating a PR is a create action, viewing one is neutral
- **WHEN** worktree session `s1` has no PR yet and its menu opens
- **THEN** **Open PR** SHALL carry `data-action-tone="create"`
- **AND WHEN** `s1` has PR #12 with a known URL
- **THEN** **View PR #12** SHALL carry no `data-action-tone`

#### Scenario: Merge in NEXT shows NEXT emphasis, not its go tone
- **WHEN** worktree session `s1` has an open, non-draft PR with passing checks, so that Merge is the NEXT item
- **THEN** the NEXT item **Merge** SHALL carry `data-emphasis="primary"` and no `data-action-tone`
- **AND** its icon SHALL be coloured `--accent-blue-text`

#### Scenario: Disabled NEXT carries no tone
- **WHEN** session `s1` is streaming and its NEXT item is Verify
- **THEN** the NEXT item SHALL render `aria-disabled="true"` with no `data-action-tone`

#### Scenario: Inherited object keys are not tones
- **WHEN** an item arrives with `tone: "constructor"`, and separately with `tone: "__proto__"`
- **THEN** it SHALL render with no `data-action-tone`, a neutral icon and the neutral hover

#### Scenario: Tone colours meet contrast in every palette
- **WHEN** each built-in palette is applied in dark and light mode
- **THEN** each of `--accent-green-text`, `--accent-blue-text`, `--accent-orange-text` and `--accent-red-text` SHALL measure at least 3:1 against the menu surface
- **AND** `--accent-red-text` SHALL measure at least 3:1 against `--tint-red-bg`
- **AND** `--accent-red-text` SHALL measure at least 4.5:1 against `--tint-red-bg`

### Requirement: NEXT and the lifecycle row use state colour

When enabled, the `NEXT` item SHALL render with:
- a `--tint-blue-border` border;
- its icon coloured `--accent-blue-text`;
- its label in semibold `--text-primary`, on the menu surface.

It SHALL NOT be filled with a tinted background, because text on `--tint-blue-bg` falls below 4.5:1 in some palettes. The border is decorative. NEXT is identified by its own `NEXT` group heading, its semibold label and its blue icon (at least 3:1), so the border needs no contrast floor. When enabled, the NEXT item keeps the neutral hover and keyboard-focus background. When the NEXT item is disabled (session working), it SHALL use the disabled rendering, with no border accent and no icon colour.

Each segment of the `OPENSPEC` lifecycle artifact row SHALL show a state bar above its letter. Bar and letter use the same colour:
- `done`: `--accent-green-text`, glyph `✓`;
- `current`: `--accent-yellow-text`, glyph `▸`;
- `skipped`: `--accent-green-text`, glyph `–`;
- `todo`: `--text-tertiary`, glyph `○`.

These are the hues of the card lifecycle bar's states, expressed through text-role tokens so that the bar and the letter reach at least 3:1 against the menu surface in every built-in palette and mode. Every state carries a distinct visible glyph beside the letter, so no two states differ by colour alone (WCAG 1.4.1). The accessible name (`<label>, <state>`) also states it in words. The segment SHALL expose its state as `data-state`, one of `done | current | skipped | todo`, where `todo` is the state the lifecycle-mirroring requirement calls pending.

#### Scenario: NEXT is outlined, not filled
- **WHEN** session `s1` is attached to an `IMPLEMENTING` change and is idle
- **THEN** the NEXT item **Apply** SHALL render a `--tint-blue-border` border and an `--accent-blue-text` icon
- **AND** its background SHALL equal the menu surface

#### Scenario: Working session's NEXT is not accented
- **WHEN** session `s1` is streaming
- **THEN** the NEXT item SHALL render `aria-disabled="true"` without the `--tint-blue-border` border

#### Scenario: Lifecycle bars reflect state with sufficient contrast
- **WHEN** the attached change has Proposal and Design done, Specs current, and Tasks and Archive todo
- **THEN** the P and D bars SHALL be `--accent-green-text` with glyph `✓`, S `--accent-yellow-text` with glyph `▸`, and T and A `--text-tertiary` with glyph `○`
- **AND** each bar colour SHALL measure at least 3:1 against the menu surface
- **AND** each segment's accessible name SHALL include its state word

## MODIFIED Requirements

### Requirement: Plugin contributions render inside the PLUGINS group

The menu SHALL host plugin actions through the existing `session-card-action-bar` slot. No new slot or contribution mechanism is added. The only plugin-facing addition is the optional `tone` field on existing `ui:action-list` items (see `plugin-ui-primitive-registry`).

**Lifecycle.** Claims on the slot SHALL stay mounted for the lifetime of the desktop card, so their effects, subscriptions and the dialogs they own survive the menu closing. Their rendered output SHALL appear only inside the menu's `PLUGINS` group, with their existing props, per-claim error isolation, and the per-plugin `actionbar-<pluginId>` visibility filter.

**Rendering:**
- Intent `action-list` contributions on the slot SHALL render as `menuitem`s, honouring each action's optional `tone` (see "Menu items carry an optional semantic tone").
- React claim output SHALL render inside a labelled group per plugin.
- Activating an enabled control inside plugin output SHALL close the menu and SHALL NOT select the card. A dialog the claim opened in response SHALL stay open.
- The `PLUGINS` heading SHALL render only when plugin output has rendered content.

#### Scenario: Plugin output appears only in the menu
- **WHEN** the goal plugin's `session-card-action-bar` claim renders for goal-linked session `s1`
- **THEN** its output SHALL NOT render on the card
- **AND** it SHALL render in the `PLUGINS` group of `s1`'s menu when the menu is open

#### Scenario: Claim-owned dialog survives the menu closing
- **WHEN** the user activates **Run Flow…** in the `PLUGINS` group of `s1`'s menu
- **THEN** the menu SHALL close
- **AND** the flows plugin's run dialog SHALL open and stay open

#### Scenario: Intent action list renders as menu items
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1`
- **THEN** each action SHALL render in `s1`'s menu with `role="menuitem"`

#### Scenario: Claim rendering nothing leaves no heading
- **WHEN** the only action-bar claim renders `null` for session `s1`
- **THEN** `s1`'s menu SHALL NOT render a `PLUGINS` heading

#### Scenario: Plugin action-list item honours its tone
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1` with one action `{ label: "Stop recording", tone: "danger" }`
- **THEN** that action's `menuitem` in `s1`'s `PLUGINS` group SHALL carry `data-action-tone="danger"` and an icon coloured `--accent-red-text`
