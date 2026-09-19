## MODIFIED Requirements

### Requirement: CLI commands
The package SHALL expose a `deck3d` binary with `parse <deck.md> [-o deck.json]`, `validate <deck.json>`, `render <deck.json> [-o deck.html]`, `build <deck.md> [-o deck.html]` (parse + render, emitting the intermediate `deck.json` beside the output), `props search|fetch|generate` (`search --role`, `generate --prompt`, see deck3d-props), `fx list|preview|scaffold|hash|promote` (effects catalogue and deck-local effects, see deck3d-effects and deck3d-local-effects), `overrides apply <deck.json> <overrides.json>` (merge a configurator export, see deck3d-configurator), `check <deck.html> [--style]` (browser fit/legibility report, see deck3d-render), and `snapshot <deck.html> [--slide n] [-o png]` (headless screenshot for verification). Each command SHALL exit 0 on success and non-zero on failure with a one-line reason on stderr.

#### Scenario: One-shot build
- **WHEN** `deck3d build talk.md -o talk.html` runs
- **THEN** `talk.json` and `talk.html` exist and `talk.json` equals the output of `deck3d parse talk.md`

#### Scenario: Snapshot for verification
- **WHEN** `deck3d snapshot talk.html --slide 5 -o s5.png` runs
- **THEN** a PNG of slide 5 after transition arrival is written

#### Scenario: Help lists every command
- **WHEN** `deck3d --help` runs
- **THEN** the output names `fx scaffold`, `fx hash`, `fx promote`, `overrides apply`, `check --style`, `props search --role` and `props generate --prompt`

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
