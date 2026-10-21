## MODIFIED Requirements

### Requirement: Hook re-trust banners; template drift does not

A change to the hook definition hash revokes trust and blocks the hook from running from a UI click. That state — and the never-trusted state, which the init-status payload does not distinguish from it — SHALL render a banner at `--severity-warning-*` carrying the message "Init hook needs your trust before it can run" and a `Review & trust` action opening the existing trust-confirm dialog. The action SHALL keep test id `worktree-init-btn`.

Template drift (`setupOutdated: true`) SHALL surface only as a `● update` badge on the menu's permanent `Project setup…` item.

#### Scenario: Revoked trust banners at warning severity

- **GIVEN** a directory whose hook definition changed since it was last trusted
- **WHEN** the card renders
- **THEN** a warning-severity banner SHALL render with the message "Init hook needs your trust before it can run" and a `Review & trust` action
- **AND** activating it SHALL open the trust-confirm dialog

#### Scenario: Drift badges the menu item only

- **GIVEN** a directory reporting `setupOutdated: true`
- **WHEN** the folder actions menu opens
- **THEN** the `Project setup…` item SHALL carry a `● update` badge

#### Scenario: A never-trusted hook gets the same banner

- **GIVEN** a directory whose hook has no trust record yet (`trusted: false`)
- **WHEN** the card renders
- **THEN** the same warning-severity banner, message and `Review & trust` action SHALL render
- **AND** the message SHALL NOT claim the hook changed

### Requirement: Banner uses existing severity tokens and distinct glyphs

Banner surfaces SHALL draw colour exclusively from the existing `--severity-{info,warning,error}-{bg,fg,border}` triples. No new colour token SHALL be introduced.

The banner's chrome and single-line content — glyph, message, action control, and the running, done and failed status of an init run (status text, elapsed time, failure code line, last-output preview line, spinner arc, progress bar, Retry control, and the `View log` disclosure toggle) — SHALL paint the banner's own `--severity-<sev>-fg` by inheriting it. None of them SHALL apply its own text, border or fill colour, use a raw palette colour, or use `--text-muted`. Contrast for that content is therefore exactly the triple's own `-fg`/`-bg` contrast as gated by `message-severity-tokens`, including that gate's documented sub-AA cells (tokyo-night light `info`).

The expanded log body (the multi-line stderr / log tail behind the disclosure) is multi-line content and SHALL follow `message-severity-tokens` "Severity styles the chrome, not multi-line body content": `--text-secondary` on `--bg-code`, at 11 px or larger.

Glyphs SHALL be: project setup `mdiTextBoxCheckOutline` (replacing `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen`), run init hook `mdiScriptTextPlayOutline` (replacing `mdiCogPlayOutline`, which collided with `mdiCog`), hook re-trust `mdiShieldAlertOutline`, init done `mdiCheckCircleOutline`, init failed `mdiAlertCircleOutline`, init retry `mdiReplay`, cleanup `mdiBroom`. No glyph SHALL carry two meanings on the rendered card.

#### Scenario: No new tokens

- **WHEN** the banner renders at any severity
- **THEN** its colours SHALL resolve from an existing `--severity-*` triple

#### Scenario: Setup and hook glyphs are distinct from the card's other glyphs

- **WHEN** a card renders the folder glyph, the settings cog and a setup banner
- **THEN** no two of them SHALL use the same glyph

#### Scenario: Hosted controls do not re-tint in a light palette

- **GIVEN** the base light theme
- **WHEN** the retrust, init-needed, running, done and failed banners render
- **THEN** every text node inside each banner SHALL measure at least 4.5:1 against its composited background
- **AND** every glyph and the spinner arc SHALL measure at least 3:1

#### Scenario: Inherited colour holds across palettes

- **WHEN** the retrust banner renders in each of base dark, base light, nord dark and nord light
- **THEN** the action control's computed text colour SHALL equal the banner region's computed text colour

#### Scenario: Expanded log body keeps code colours

- **GIVEN** a failed init run whose log disclosure is opened
- **WHEN** the banner renders
- **THEN** the log body SHALL paint `--text-secondary` on `--bg-code`
- **AND** the `View log` toggle SHALL paint the banner's `--severity-error-fg`

## ADDED Requirements

### Requirement: Hook rungs pair a message with one inherited-colour action

The `retrust` and `init-needed` rungs SHALL render the rung glyph, a short message stating why the folder is blocked (it MAY wrap at narrow widths), and exactly one action button. The button SHALL carry no glyph of its own; the rung glyph is the only icon in the row. The button SHALL be outlined in the inherited text colour (`currentColor` border), render its label at 12 px or larger, show a visible focus ring, and meet the 44 px touch target at mobile width.

#### Scenario: Retrust rung explains itself

- **GIVEN** a directory whose hook is not trusted
- **WHEN** the card renders
- **THEN** the banner SHALL contain the message "Init hook needs your trust before it can run" outside the action button
- **AND** the button's text SHALL be `Review & trust`

#### Scenario: Init-needed rung explains itself

- **GIVEN** a directory with a trusted hook whose gate reports `needsInit: true`
- **WHEN** the card renders
- **THEN** the banner SHALL contain the message "Init hook hasn't run in this checkout" and an `Initialize` button

#### Scenario: Rung copy is localised

- **GIVEN** the UI language is Hungarian
- **WHEN** the retrust banner renders
- **THEN** both its message and its action label SHALL come from the Hungarian catalog, not English fallbacks

### Requirement: Init run outcomes in the banner keep their shape

A failed run SHALL show "Init failed" with its failure code and message on a second line, a `Retry` button using the outlined inherited-colour recipe, and the log disclosure. During its brief success confirmation (before the banner clears per `worktree-init-feedback`), a completed run SHALL stay on the info rung showing "Initialized" and its elapsed time.

#### Scenario: Failure detail on its own line

- **GIVEN** an init run that failed with code `script_nonzero_exit`
- **WHEN** the banner renders
- **THEN** "Init failed" SHALL render with `script_nonzero_exit` on a second line
- **AND** a `Retry` button SHALL be present, outlined in the inherited colour

#### Scenario: Completed run confirms at info severity

- **WHEN** an init run completes and its success confirmation is showing
- **THEN** the banner SHALL be at `--severity-info-*` showing "Initialized" and the elapsed seconds
- **AND** the banner SHALL still clear once init-status reports no further need
