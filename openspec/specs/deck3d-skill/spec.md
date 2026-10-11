# deck3d-skill Specification

## Purpose
The `deck3d` pi skill and CLI: the surface through which an agent converts a markdown deck deterministically and then fine-tunes the result by editing the IR.

## Requirements

### Requirement: CLI commands
The package SHALL expose a `deck3d` binary with these commands:
- `parse <deck.md> [-o deck.json]`
- `validate <deck.json>`
- `render <deck.json> [-o deck.html]`
- `build <deck.md> [-o deck.html]`: parse + render, emitting the intermediate `deck.json` beside the output
- `props search|fetch|generate`: `search --role`, `generate --prompt`, see deck3d-props
- `fx list|preview|scaffold|hash|promote`: effects catalogue and deck-local effects, see deck3d-effects and deck3d-local-effects
- `overrides apply <deck.json> <overrides.json>`: merge a configurator export, see deck3d-configurator
- `check <deck.html> [--style]`: browser fit/legibility report, see deck3d-render
- `snapshot <deck.html> [--slide n] [-o png]`: headless screenshot for verification
- `pptx import <file.pptx>`: see deck3d-pptx-import
- `art trace|icon|cutout`: see deck3d-art-tooling
- `variants render|pick|note|replay`: see deck3d-variant-loop
- `compare <deck.html>`: see deck3d-variant-loop

Each command SHALL exit 0 on success and non-zero on failure with a one-line reason on stderr.

#### Scenario: One-shot build
- **WHEN** `deck3d build talk.md -o talk.html` runs
- **THEN** `talk.json` and `talk.html` exist and `talk.json` equals the output of `deck3d parse talk.md`

#### Scenario: Snapshot for verification
- **WHEN** `deck3d snapshot talk.html --slide 5 -o s5.png` runs
- **THEN** a PNG of slide 5 after transition arrival is written

#### Scenario: Help lists every command
- **WHEN** `deck3d --help` runs
- **THEN** the output names `fx scaffold`, `fx hash`, `fx promote`, `overrides apply`, `check --style`, `props search --role`, `props generate --prompt`, `pptx import`, `art trace`, `art icon`, `art cutout`, `variants render`, `variants pick`, `variants note`, `variants replay` and `compare`

### Requirement: Skill teaches the tune loop
The skill SHALL instruct the agent to: (1) `parse`, (2) `validate` and read the IR, (3) `render`, (4) **Style pass** — for every slide, read `build`'s `style:` line and `check --style` findings, then for each unstyled slide choose a corpus effect by `fx list --topic` **or** `fx scaffold` a deck-local effect for the slide's topic and `fx preview` it before use; give every content slide without a mermaid block a built `diagram.kind` (accepting or overriding the parse default); run `props search` per section for `hero`/`illustration` and `props search --role ambient` for background-world instances; a deck SHALL NOT be reported finished while `check --style` still warns unless the agent states why; (5) `check` and fix every reported finding by editing the suggested `overrides` key, (6) `snapshot` every slide and inspect for what the checks cannot measure (taste, composition), editing only `overrides` and `fx/`, (7) re-`render` + `check` + `snapshot`, repeating until `check` is clean, the style line reads all slides styled, and the snapshots look right. For illustration, the skill SHALL teach the prop loop: extract 2–4 content keywords per slide (title, bullets, diagram labels), `props search`, pick by relevance then style consistency (prefer vendored/low-poly, `restyle: palette`), write the `overrides.props[]` entry, `props fetch`, render, snapshot. The skill SHALL teach that the configurator's Export feeds `overrides apply`, that markdown inline overrides still win, and that `Math.random`, timers and network are unavailable inside local effects by design. The skill SHALL forbid editing the generated HTML directly and SHALL forbid editing derived (non-override) IR fields, so a re-parse never loses tuning.

#### Scenario: Agent tunes a slide
- **WHEN** a screenshot shows a diagram overlapping the bullet panel
- **THEN** the skill's procedure leads the agent to set a per-slide override (e.g. diagram scale/offset) in `overrides`, re-render, and re-snapshot — not to patch HTML or engine code

#### Scenario: Agent illustrates a slide
- **WHEN** a slide about "monitoring" has empty space beside the bullets
- **THEN** the skill's procedure leads the agent to search e.g. `telescope radar`, pick a CC0 candidate, attach it with `role: illustration`, fetch, render and verify by snapshot

#### Scenario: Agent styles a slide
- **WHEN** a slide about "network security" has a flat default background and the agent wants more atmosphere
- **THEN** the skill's procedure leads the agent to run `fx list --tag network`, pick by mood and cost within the slide's `quality` budget, write `overrides.slides["<slideId>"].effects`, re-render, `check` and snapshot — not to write shader or engine code

#### Scenario: Check finding drives the fix
- **WHEN** `check` reports `warn legibility slide 6 "Megfigyelés" 9px < 14px` suggesting `overrides.slides["megfigyeles"].labels.size`
- **THEN** the skill's procedure leads the agent to set that key in `overrides`, re-render and re-check — not to widen the camera by trial

#### Scenario: Derived-field edit is caught
- **WHEN** the agent edits a derived node position outside `overrides`
- **THEN** `validate` warns that the edit lives outside `overrides` and will be lost on re-parse

#### Scenario: Bare deck is not finished
- **WHEN** `build` prints `style: 6/23 slides styled` and `check --style` lists 17 `style-defaults` warnings
- **THEN** the skill's procedure leads the agent through the Style pass on the 17 slides (corpus pick, local scaffold, built kind, props) before declaring the deck done

#### Scenario: Corpus lacks the topic
- **WHEN** a slide is about "container shipping lanes" and no corpus background fits
- **THEN** the skill's procedure leads the agent to `fx scaffold shipping-lanes --for <slideId>`, write the effect against `ctx.THREE`/`ctx.rng`, `fx preview local:shipping-lanes`, paste the printed override, `validate`, `build` — never to edit the runtime or the corpus in place

### Requirement: Markdown slide grammar
The skill SHALL document the accepted markdown deck grammar:
- `# Title` starts a slide. A document with no `# Title` yields one slide with id `slide` from the whole body.
- The first paragraph after it is the subtitle.
- `-` items are bullets.
- A ```mermaid block attaches a diagram.
- A `<!-- deck3d: {...} -->` comment sets per-slide IR overrides inline. It MAY span several lines and MAY be written as a bullet (`- <!-- deck3d: {...} -->`). In every form it SHALL be read as an override and SHALL never be taken as, or be part of, the subtitle or any bullet.

Front-matter SHALL set deck-level defaults (palette, mode, material, transition, quality).

#### Scenario: Inline override
- **WHEN** a slide contains `<!-- deck3d: {"mode":"light","scene":"orbits"} -->`
- **THEN** the parsed IR records these under `overrides.slides["<slideId>"]`, and they win over any `deck.json` value for the same keys (with a warning)

#### Scenario: Grammar error
- **WHEN** the inline comment is not valid JSON
- **THEN** parse exits non-zero naming the slide and the JSON error

#### Scenario: Override comment on an empty-title slide
- **WHEN** a slide is `# {#s02}` followed directly by `<!-- deck3d: {"mode":"light"} -->` and no other text
- **THEN** the parsed slide has no subtitle, and the override is recorded under `overrides.slides["s02"]`

#### Scenario: Multi-line and bullet-form overrides
- **WHEN** one slide has an override comment spread over three lines and another has `- <!-- deck3d: {"mode":"dark"} -->` among its bullets
- **THEN** both overrides are recorded, neither slide's subtitle or bullets contain comment text, and the second slide's bullet count excludes the override line

### Requirement: Skill and CLI ship together
The package SHALL be publishable as a pi package that registers the skill and the binary, installable via the dashboard's standard package flow.

#### Scenario: Skill discovered
- **WHEN** the package is installed in a pi project
- **THEN** the `deck3d` skill appears in the available skills and `deck3d --help` runs

### Requirement: Skill documents camera motions
The deck3d skill SHALL list every transition id with a one-line description of the move, explain per-slide
`transition`/`durationSec`, deck-level `transitionCycle`, and `cameraPath` (travel-frame offsets as fractions of
the travel length, implied pinned endpoints, `look`/`roll`/`fov`, reverse playback on back navigation), and SHALL
include one worked `cameraPath` example. It SHALL warn that camera-pinned local effects tilt with `roll`.

#### Scenario: Agent picks a motion from the skill
- **WHEN** an agent reads the skill to vary slide changes
- **THEN** it finds the id list, the `transitionCycle` field and a `cameraPath` example it can paste into `deck.json`
