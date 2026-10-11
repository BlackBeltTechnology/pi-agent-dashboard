## MODIFIED Requirements

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
