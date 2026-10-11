# deck3d-pptx-tutorial Specification

## Purpose
The `deck3d-from-pptx` skill guides an agent and a user, tutorial-style, from an existing pptx to a styled deck3d presentation. At each styling step it generates variants, shows them, asks the user, and records the choice, so the result is faithful to the original and every creative decision is the user's.

## Requirements

### Requirement: Skill ships with deck3d
The deck3d package SHALL register a second skill `deck3d-from-pptx`, discoverable when the package is installed. The `deck3d` skill SHALL reference it for pptx sources. The tutorial SHALL keep every rule of the deck3d tune loop: never edit `deck.html`, never edit derived IR fields, no randomness, timers or network in local effects, and finish with `check --style` clean or every remaining warning explained. A derived `credits` slide counts as explained.

#### Scenario: Skill discovered
- **WHEN** the deck3d package is installed in a pi project
- **THEN** both `deck3d` and `deck3d-from-pptx` appear in the available skills

### Requirement: Staged procedure with fixed step order
The skill SHALL instruct the agent to run `pptx import` and to obtain reference renders first: ask the user for a PNG export of the deck (`--ref`) unless LibreOffice and `pdftoppm` are available. If the user declines, every later step SHALL report snapshot review instead of `compare` scores, and say so. The agent then builds the baseline and walks these steps in order:
1. `fidelity`: exact 2D layer / 3D panel / native deck3d
2. `placement`: glass panel / free-floating / frame in space
3. `frame`: master chrome and its transition animation
4. `brand-art`: logos, wordmarks, headline in 3D
5. `icons`: pictograms as 3D objects, optionally on cards
6. `hero`: hero illustrations rebuilt as 3D scenes
7. `worlds`: per-slide background worlds from slide text, plus haze
8. `media`: images replaced by video
9. `transitions`: transition and camera-path variety

When the user picks `native` at `fidelity`, steps 2, 3 and 5 SHALL be skipped. For a native deck:
- brand art goes beside the native title;
- hero scenes and worlds become slide backgrounds;
- media becomes a video screen;
- transitions are unchanged.

The `worlds` step SHALL give every slide a non-default background, so a native deck also clears `check --style`.

#### Scenario: Native skips layer steps
- **WHEN** the user picks the native variant at `fidelity`
- **THEN** the procedure's next step is `brand-art`, and no `slide-layer`, `frame-chrome` or `icon3d` effect appears in `deck.json`

### Requirement: Every step generates variants and asks
For each step the skill SHALL instruct the agent to:
1. write the step into `style.json` with 2–4 ordered variants, authored from the imported layout and slide text, plus sample slides covering the step's affected kinds. Each fragment carries forward the effects of earlier steps on the same scope.
2. run `variants render`;
3. open `contact.png` on the canvas and include the live `serve` link (`?variant=<step>:<name>`) in the question;
4. ask the user with a single-choice question listing the variants by label, free text allowed;
5. on a variant answer, run `variants pick`; on a free-text answer, run `variants note` and author a new round from the note;
6. then `build` and `compare`, and report per-slide scores (or the snapshot review when there are no reference renders).

The final deliverable SHALL be rendered with `--embed-video` whenever any slide uses a video screen, so the single file plays offline. The skill SHALL say that a `file://` deck without embedding cannot play its clips.

The agent SHALL NOT pick a variant itself while the question tool is available. When the skill is run with the explicit headless instruction, it SHALL pick the first variant in array order and record `note: "auto"`.

#### Scenario: Video deck delivered self-contained
- **WHEN** the `media` step picked a variant that puts a video on slide 4
- **THEN** the final `deck.html` is rendered with `--embed-video` and plays the clip when opened from `file://`

#### Scenario: Interactive pick recorded
- **WHEN** the user answers "B" at the `placement` step
- **THEN** `style.json` has `steps[placement].picked = "B"` with a timestamp, and `deck.json` contains B's fragment

#### Scenario: Free-text answer
- **WHEN** the user answers "like B but without the glass panel"
- **THEN** `style.json` records the note with `picked: null`, the step's `round` increments, and the agent offers a new set of variants for the same step

### Requirement: Creative assets are scaffolded, not invented in core
For `hero` and `worlds`, the skill SHALL instruct the agent to scaffold per-deck local effects (`fx scaffold`) whose content comes from the slide's text and pictures. Each variant SHALL be a different take on the same content (for example a literal scene vs a metaphor vs a minimal motif). The agent SHALL preview each before offering it.

#### Scenario: World from slide text
- **WHEN** slide 2 says "annual inspection by an external expert, documented"
- **THEN** each offered `worlds` variant for slide 2 is a local effect depicting elements named in that text

### Requirement: Known pitfalls are taught
The skill SHALL document, as checks the agent runs after each step:
- objects resting on the floor are lifted above it to avoid z-fighting;
- text halos use normal blending on light themes;
- master chrome uses the persistent `frame-chrome` effect, not per-slide overlays;
- font-metric wrap drift is checked against the reference for every multi-line text box and fixed with `widen` or a font asset;
- after an in-place file replacement that serve may miss, rebuild manually;
- verification uses the user's actual viewport and also captures mid-transition frames (`compare --transition`).

#### Scenario: Wrap drift caught
- **WHEN** `compare` shows a closing slide line wrapping onto two lines while the reference has one
- **THEN** the skill's procedure leads the agent to set `widen` for that item and re-run `compare`
