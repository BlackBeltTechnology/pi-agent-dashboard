## MODIFIED Requirements

### Requirement: Banner uses existing severity tokens and distinct glyphs

Banner surfaces SHALL draw colour from the existing `--severity-{info,warning,error}-{bg,fg,border}` triples. The only other colours allowed are `--text-secondary` for secondary single-line run text and the code colours of the expanded log body, both named below. No new colour token SHALL be introduced.

The banner's chrome SHALL paint the banner's own `--severity-<sev>-fg` by inheriting it. Chrome here means: the glyph, the rung message, the action control, and the init-run status label, spinner arc, progress bar, Retry control and `View log` disclosure toggle. None of them SHALL apply its own text, border or fill colour, use a raw palette colour, or use `--text-muted`; `currentColor` alpha tints of the inherited colour (track, hover fill) count as inheriting. Contrast for that content is therefore exactly the triple's own `-fg`/`-bg` contrast as gated by `message-severity-tokens`, including that gate's documented sub-AA cells (tokyo-night light `info`).

The `View log` disclosure toggle SHALL be underlined and at least 12 px.

Secondary single-line run text is quiet body copy (`ui-contract.md` a11y rule 6), not chrome. It covers the elapsed time (running and done), the last-output preview line and the failure message line. It SHALL paint `--text-secondary`, never the inherited fg or `--text-muted`. It SHALL measure at least 4.5:1 against the banner background in all 18 theme×mode combos.

The expanded log body (the multi-line stderr / log tail behind the disclosure) is multi-line content and SHALL follow `message-severity-tokens` "Severity styles the chrome, not multi-line body content": `--text-secondary` on `--bg-code`, at 11 px or larger.

Glyphs:

| Use | Glyph | Notes |
|---|---|---|
| project setup | `mdiTextBoxCheckOutline` | replaces `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen` |
| run init hook | `mdiScriptTextPlayOutline` | replaces `mdiCogPlayOutline`, which collided with `mdiCog` |
| hook re-trust | `mdiShieldAlertOutline` | |
| init done | `mdiCheckCircleOutline` | |
| init failed | `mdiAlertCircleOutline` | |
| init retry | `mdiReplay` | |
| cleanup | `mdiBroom` | |

No glyph SHALL carry two meanings on the rendered card.

#### Scenario: No new tokens

- **WHEN** the banner renders at any severity
- **THEN** its colours SHALL resolve from an existing `--severity-*` triple, `--text-secondary`, or the log body's `--bg-code`

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

#### Scenario: Secondary run text meets AA in every theme

- **GIVEN** a running banner with elapsed time and a last-output preview, and a failed banner with a failure message line
- **WHEN** each renders in each of the 18 theme×mode combos
- **THEN** the elapsed time, preview and failure message line SHALL paint `--text-secondary`
- **AND** each SHALL measure at least 4.5:1 against its composited background

#### Scenario: Expanded log body keeps code colours

- **GIVEN** a failed init run whose log disclosure is opened
- **WHEN** the banner renders
- **THEN** the log body SHALL paint `--text-secondary` on `--bg-code`
- **AND** the `View log` toggle SHALL paint the banner's `--severity-error-fg`, underlined, at 12 px or larger
