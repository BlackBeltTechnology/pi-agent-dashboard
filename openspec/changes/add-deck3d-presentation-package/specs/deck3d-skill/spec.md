## Purpose

The `deck3d` pi skill and CLI: the surface through which an agent converts a markdown deck deterministically and then fine-tunes the result by editing the IR.

## ADDED Requirements

### Requirement: CLI commands
The package SHALL expose a `deck3d` binary with `parse <deck.md> [-o deck.json]`, `validate <deck.json>`, `render <deck.json> [-o deck.html]`, `build <deck.md> [-o deck.html]` (parse + render, emitting the intermediate `deck.json` beside the output), `props search|fetch|generate`, `fx list|preview` (effects catalogue, see deck3d-effects), `check <deck.html>` (browser fit/legibility report, see deck3d-render), and `snapshot <deck.html> [--slide n] [-o png]` (headless screenshot for verification). Each command SHALL exit 0 on success and non-zero on failure with a one-line reason on stderr.

#### Scenario: One-shot build
- **WHEN** `deck3d build talk.md -o talk.html` runs
- **THEN** `talk.json` and `talk.html` exist and `talk.json` equals the output of `deck3d parse talk.md`

#### Scenario: Snapshot for verification
- **WHEN** `deck3d snapshot talk.html --slide 5 -o s5.png` runs
- **THEN** a PNG of slide 5 after transition arrival is written

### Requirement: Skill teaches the tune loop
The skill SHALL instruct the agent to: (1) `parse`, (2) `validate` and read the IR, (3) `render`, (4) `check` and fix every reported finding by editing the suggested `overrides` key, (5) `snapshot` every slide and inspect for what the checks cannot measure (taste, composition), editing only `overrides`, (6) re-`render` + `check` + `snapshot`, repeating until `check` is clean and the snapshots look right. For illustration, the skill SHALL teach the prop loop: extract 2–4 content keywords per slide (title, bullets, diagram labels), `props search`, pick by relevance then style consistency (prefer vendored/low-poly, `restyle: palette`), write the `overrides.props[]` entry, `props fetch`, render, snapshot. The skill SHALL forbid editing the generated HTML directly and SHALL forbid editing derived (non-override) IR fields, so a re-parse never loses tuning.

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

### Requirement: Markdown slide grammar
The skill SHALL document the accepted markdown deck grammar: `# Title` starts a slide (a document with no `# Title` yields one slide with id `slide` from the whole body), first paragraph after it is the subtitle, `-` items are bullets, a ```mermaid block attaches a diagram, and a `<!-- deck3d: {...} -->` comment sets per-slide IR overrides inline. Front-matter SHALL set deck-level defaults (palette, mode, material, transition, quality).

#### Scenario: Inline override
- **WHEN** a slide contains `<!-- deck3d: {"mode":"light","scene":"orbits"} -->`
- **THEN** the parsed IR records these under `overrides.slides["<slideId>"]`, and they win over any `deck.json` value for the same keys (with a warning)

#### Scenario: Grammar error
- **WHEN** the inline comment is not valid JSON
- **THEN** parse exits non-zero naming the slide and the JSON error

### Requirement: Skill and CLI ship together
The package SHALL be publishable as a pi package that registers the skill and the binary, installable via the dashboard's standard package flow.

#### Scenario: Skill discovered
- **WHEN** the package is installed in a pi project
- **THEN** the `deck3d` skill appears in the available skills and `deck3d --help` runs
