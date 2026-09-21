# deck3d-render Specification

## Purpose
Turn a validated Deck IR into a single, offline, self-contained HTML file that presents the deck as an animated 3D scene.

## Requirements

### Requirement: Render is deterministic and self-contained
The same IR with the same package version SHALL produce a byte-identical `deck.html`. The output SHALL be a single file with every asset (3D runtime, fonts, images, textures) embedded; opening it from `file://` with no network SHALL show the full deck.

#### Scenario: Byte-identical re-render
- **WHEN** the same `deck.json` is rendered twice
- **THEN** the two HTML files are byte-identical

#### Scenario: Offline open
- **WHEN** `deck.html` is opened from disk with networking disabled
- **THEN** every slide, title, diagram and font renders and the browser console shows no failed resource loads

### Requirement: Navigation and slide model
The deck SHALL step through slides in IR order with keyboard (`ArrowRight`/`ArrowLeft`/`Space`) and a URL hash `#<n>` that lands directly on slide n. Each slide SHALL show its title, optional subtitle, bullets, and its diagram or built topology when present.

#### Scenario: Deep link
- **WHEN** `deck.html#5` is opened
- **THEN** slide 5 is shown without playing the earlier transitions

### Requirement: Hungarian titles render intact
Extruded 3D title text SHALL render every Hungarian glyph, including `ő ű Ő Ű`, from an embedded, subset TrueType font. Glyph outlines SHALL not be dropped or corrupted.

#### Scenario: Double-acute glyphs
- **WHEN** a slide title contains `Ágensrajokig` and `Fejlesztő`
- **THEN** every glyph is visible as extruded geometry with no missing or clipped characters

### Requirement: Diagram builders map IR to 3D
Flowchart nodes SHALL map shape → primitive (`rect` slab, `stadium`/`round` capsule, `circle` sphere, `hexagon`/`diamond` accent metal prism), edges → tubes following the IR path with a travelling pulse, `thick` edges thicker and labelled, `dotted` edges dimmed/dashed, groups → a translucent plate behind their members, and rank → depth offset (depth relief). Sequence diagrams SHALL map actors → header slabs, time → depth (later messages further along the depth axis), messages → arrows lit in source order with a travelling pulse, `dotted` replies dimmed.

#### Scenario: Flowchart fixture
- **WHEN** the flowchart fixture is rendered and screenshotted
- **THEN** each node is present with the primitive for its shape, every edge is a tube ending in an arrowhead at its target, and the group plate encloses exactly its members

#### Scenario: Message order animation
- **WHEN** the sequence fixture plays
- **THEN** exactly one message is highlighted at a time, in source order, with its tube, arrowhead and label moving as one unit

### Requirement: Diagram labels are legible
Diagram label text (node, edge, group, actor, message) SHALL render unlit with an outline in the background colour so it stays readable over any material and never blooms. Labels SHALL sit in front of their node's surface, never inside it.

#### Scenario: Light and dark
- **WHEN** the same slide is rendered in `dark` and `light` mode
- **THEN** labels are readable in both: light text with dark outline on dark, dark text with light outline on light

#### Scenario: Label on round node
- **WHEN** a `stadium` or `circle` node has a label
- **THEN** the label is fully visible in front of the surface, not clipped by the mesh

### Requirement: Render loop tolerates hidden tabs
Animation SHALL continue while the page is hidden or in a headless/background tab, so build-time screenshots and automated verification capture a finished frame.

#### Scenario: Headless screenshot
- **WHEN** the deck is opened headless and a screenshot is taken after the transition duration
- **THEN** the camera has arrived and the slide is fully rendered

### Requirement: Quality tiers
A `quality` value (`low` | `medium` | `high`) in the IR SHALL scale post-processing, shadow resolution, reflection and particle counts so a weaker GPU still plays the deck.

#### Scenario: Low quality
- **WHEN** `quality: low` is set
- **THEN** the deck renders without bloom and mirror reflections, and with reduced particle count, while all content remains present

### Requirement: Rendered deck exposes a measurement hook
The rendered HTML SHALL expose `window.__deck3d` with `gotoSlide(n)`, `setTime(t)` (deterministic animation clock), `ready()` (resolves after camera arrival and one rendered frame) and `measure()` returning, for every labelled object on the current slide (title, bullets, diagram nodes/edges/actors/messages, props), its projected screen rect in CSS px, its label cap height in px, its kind and id, and the first raycast hit between camera and label centre.

#### Scenario: Measurement is stable
- **WHEN** `measure()` is called twice at the same slide and `setTime` value with a fixed viewport
- **THEN** both results are identical

### Requirement: Browser fit-and-legibility check
`check <deck.html> [--viewport WxH[,WxH]] [--slide n] [--strict] [-o report.json]` (default viewports `1920x1080,1280x720`; 120 s timeout per viewport, exit non-zero naming the viewport on timeout) SHALL open the deck headless at devicePixelRatio 1, and for every slide at `t=0` and at each animation peak reported by the deck evaluate: **fit** — union of all content rects inside the viewport minus a safe margin (default 4 %); **legibility** — every label cap height ≥ minimum (default 14 px at 1920×1080, scaled by viewport height); **overlap** — no two label rects intersect with IoU > 0.1; **occlusion** — no label's raycast hit is an object other than the label or its own node; **contrast** — luminance ratio between label text colour and the mean rendered pixels behind its rect ≥ 3:1. Each finding SHALL name slide, object id/label text, measured vs threshold values, a severity (`error` for fit/overlap/occlusion, `warn` for legibility/contrast) and a suggested key spelled in the `overrides` grammar (e.g. `overrides.slides["<slideId>"].diagram.scale`). Contrast ratios SHALL be rounded to 0.1 and contrast findings are excluded from the report byte-equality guarantee (GPU-dependent); all geometric findings SHALL be identical for the same IR and viewport. The command SHALL write a JSON report, print one line per finding on stderr, and exit non-zero when any `error` exists, or when any finding exists under `--strict`.

#### Scenario: Diagram spills out of frame
- **WHEN** a flowchart's projected right edge exceeds the safe area at 1920×1080
- **THEN** `check` reports `error fit slide <n> diagram right 1123px > 1106px` with suggestion `overrides.slides["<slideId>"].diagram.scale` and exits non-zero

#### Scenario: Label too small
- **WHEN** a node label projects to 9 px cap height
- **THEN** `check` reports a `warn legibility` finding with `9px < 14px` and suggestion `overrides.slides["<slideId>"].labels.size`, and exits 0 unless `--strict`

#### Scenario: Lifted message leaves frame at peak
- **WHEN** a sequence message fits at `t=0` but its lifted position at the pulse peak crosses the safe margin
- **THEN** `check` reports the fit error tagged with the peak time

#### Scenario: Two viewports
- **WHEN** `--viewport 1920x1080,1280x720` is given
- **THEN** findings are evaluated and reported per viewport, and the report groups them by viewport

#### Scenario: Clean deck
- **WHEN** every slide fits, is legible, non-overlapping, unoccluded and contrasting at all viewports
- **THEN** the report has zero findings and `check` exits 0

### Requirement: Build budget
`build` of the fixture deck (`fixtures/strategy-lab.md`: 7 slides, 2 mermaid blocks, no props) SHALL complete in ≤ 20 s measured from after chromium launch, and its `deck.html` SHALL be ≤ 2.5 MB.

#### Scenario: Fixture within budget
- **WHEN** `deck3d build fixtures/strategy-lab.md` runs on the CI runner with chromium present
- **THEN** the post-launch wall time is ≤ 20 s and the output file size is ≤ 2,621,440 bytes

### Requirement: Build runs check
`build` SHALL run `check` on its output after rendering and print its findings; `build` SHALL exit 0 regardless of findings unless `--strict` is passed, in which case any finding fails the build. When chromium is unavailable, `build` SHALL still write the HTML, print `check skipped: chromium missing (<install command>)` and exit 0; under `--strict` an unrunnable check fails the build. `render` and `validate` SHALL never require a browser.

#### Scenario: Build without chromium
- **WHEN** `deck3d build talk.md` runs on a host without Playwright chromium (the parse step's harvest fixture is pre-cached)
- **THEN** `talk.html` exists, the skip line names the install command, and the exit code is 0 (non-zero with `--strict`)

#### Scenario: Build with findings
- **WHEN** `deck3d build talk.md` produces a deck with one fit error
- **THEN** the finding is printed, `talk.html` exists and the exit code is 0

#### Scenario: Strict build
- **WHEN** `deck3d build talk.md --strict` produces the same deck
- **THEN** the exit code is non-zero and the finding is printed
