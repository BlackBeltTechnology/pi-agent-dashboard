## MODIFIED Requirements

### Requirement: Render is deterministic and self-contained
The same IR with the same package version and the same referenced local effect files SHALL produce a byte-identical `deck.html`. The output SHALL be a single file with every asset (3D runtime, fonts, images, textures, local effect sources) embedded; opening it from `file://` with no network SHALL show the full deck.

#### Scenario: Byte-identical re-render
- **WHEN** the same `deck.json` is rendered twice
- **THEN** the two HTML files are byte-identical

#### Scenario: Offline open
- **WHEN** `deck.html` is opened from disk with networking disabled
- **THEN** every slide, title, diagram and font renders and the browser console shows no failed resource loads

#### Scenario: Local effects embedded
- **WHEN** a deck referencing `local:neural-mesh` is rendered
- **THEN** the HTML contains the module source and card inline, loads no external script, and the effect runs on its slide offline

### Requirement: Navigation and slide model
The deck SHALL step through slides in IR order with keyboard (`ArrowRight`/`ArrowDown`/`PageDown`/`Space` forward; `ArrowLeft`/`ArrowUp`/`PageUp` back; `Home`/`End` first/last), with a primary-button click or tap anywhere outside the configurator panel (forward), and with a URL hash `#<n>` that lands directly on slide n both at load and when the hash changes afterwards. Stepping SHALL clamp at the first and last slide (no wrap), SHALL keep `location.hash` equal to the current 1-based index, SHALL ignore key events carrying a modifier, and SHALL be suppressed while a configurator input has focus. Each slide SHALL show its title, optional subtitle, bullets, and its diagram or built topology when present.

#### Scenario: Deep link
- **WHEN** `deck.html#5` is opened
- **THEN** slide 5 is shown without playing the earlier transitions

#### Scenario: Arrow keys step
- **WHEN** the deck is on slide 1 and `ArrowRight` is pressed twice then `ArrowLeft` once
- **THEN** the deck is on slide 2 and `location.hash` is `#2`

#### Scenario: Clamped at the ends
- **WHEN** the deck is on the last slide and `ArrowRight` or a click occurs
- **THEN** the deck stays on the last slide

#### Scenario: Live hash change
- **WHEN** `location.hash` is set to `#7` after load
- **THEN** the deck transitions to slide 7

#### Scenario: Click advances
- **WHEN** the presenter clicks the scene on slide 4
- **THEN** the deck is on slide 5

### Requirement: Diagram builders map IR to 3D
Flowchart nodes SHALL map shape → primitive (`rect` slab, `stadium`/`round` capsule, `circle` sphere, `hexagon`/`diamond` accent metal prism), edges → tubes following the IR path with a travelling pulse, `thick` edges thicker and labelled, `dotted` edges dimmed/dashed, groups → a translucent plate behind their members, and rank → depth offset (depth relief). Sequence diagrams SHALL map actors → header slabs, time → depth (later messages further along the depth axis), messages → arrows lit in source order with a travelling pulse, `dotted` replies dimmed. Built topologies SHALL render from `diagram.kind` without a mermaid source: `brain` (node cloud with connections), `loop` (ring of three or more stations with a travelling pulse), `swarm` (hub with orbiting agents), `bars` (one column per `data.labels` entry, height ∝ `data.values`, a value of `0` rendering a flat plinth-height stub that still carries its label, equal heights when values are absent, label below each column), `funnel` (stacked slabs narrowing downward, one per label), `timeline-rail` (milestone pucks along a rail, labels alternating above/below), `globe` (wire sphere with arcs between seeded points), `orbit-cluster` (hub sphere with satellites on tilted rings, one per label), `stack` (offset layered slabs, one per label). Every built topology SHALL expose its labelled parts to `measure()` like diagram nodes.

#### Scenario: Flowchart fixture
- **WHEN** the flowchart fixture is rendered and screenshotted
- **THEN** each node is present with the primitive for its shape, every edge is a tube ending in an arrowhead at its target, and the group plate encloses exactly its members

#### Scenario: Message order animation
- **WHEN** the sequence fixture plays
- **THEN** exactly one message is highlighted at a time, in source order, with its tube, arrowhead and label moving as one unit

#### Scenario: Bars from data
- **WHEN** a slide has `diagram.kind: bars` with `data.labels: ["A","B","C"]` and `data.values: [1, 2, 4]`
- **THEN** three columns render with heights in ratio 1:2:4, each label measurable by `measure()` as kind `node`

#### Scenario: Zero-value bar
- **WHEN** a slide has `diagram.kind: bars` with `data.values: [0, 5]`
- **THEN** the first column is a plinth-height stub whose label is still returned by `measure()`

#### Scenario: Timeline rail
- **WHEN** a slide has `diagram.kind: timeline-rail` with four labels
- **THEN** four pucks lie along one rail in label order with labels alternating above and below the rail

### Requirement: Browser fit-and-legibility check
`check <deck.html> [--viewport WxH[,WxH]] [--slide n] [--strict] [--style] [-o report.json]` (default viewports `1920x1080,1280x720`; 120 s timeout per viewport, exit non-zero naming the viewport on timeout) SHALL open the deck headless at devicePixelRatio 1 with every request whose scheme is not `file:`, `data:`, `blob:` or `about:` blocked, and for every slide at `t=0` and at each animation peak reported by the deck evaluate: **fit** — union of all content rects inside the viewport minus a safe margin (default 4 %); **legibility** — every label cap height ≥ minimum (default 14 px at 1920×1080, scaled by viewport height); **overlap** — no two label rects intersect with IoU > 0.1; **occlusion** — no label's raycast hit is an object other than the label or its own node; **contrast** — luminance ratio between label text colour and the mean rendered pixels behind its rect ≥ 3:1; **local-fx-error** — every entry the deck reports in `effects().errors` for the slide; **local-fx-network** — every blocked request attempted while the slide was measured, as `{ slide, host }` deduplicated and sorted; and, under `--style`, **style-defaults** — a slide whose effects equal the parse defaults, that has no prop and whose `diagram.kind` is the parse default. Each finding SHALL name slide, object id/label text, measured vs threshold values, a severity (`error` for fit/overlap/occlusion/local-fx-error/local-fx-network, `warn` for legibility/contrast/style-defaults) and a suggested key spelled in the `overrides` grammar (e.g. `overrides.slides["<slideId>"].diagram.scale`; `overrides.slides["<slideId>"].effects` for effect findings). Contrast ratios SHALL be rounded to 0.1; contrast and local-fx-network findings are excluded from the report byte-equality guarantee (GPU- and timing-dependent); all other findings SHALL be identical for the same IR and viewport. The command SHALL write a JSON report, print one line per finding on stderr, and exit non-zero when any `error` exists, or when any finding exists under `--strict`.

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

#### Scenario: Local effect error reported
- **WHEN** a local effect throws during `create` on slide `geo`
- **THEN** `check` reports `error local-fx-error slide geo local:<name> create` with suggestion `overrides.slides["geo"].effects`, the report contains no exception message text, and the command exits non-zero

#### Scenario: Network attempt reported
- **WHEN** an effect on slide `ai` attempts to load `https://example.com/tex.png`
- **THEN** the request is blocked and `check` reports `error local-fx-network slide ai example.com`

#### Scenario: Style pass warning
- **WHEN** `check --style` runs on a deck where slide `why` runs on parse-default effects, has no prop and no built diagram
- **THEN** `check` reports `warn style-defaults slide why` and exits 0

### Requirement: Build budget
`build` of the fixture deck (`fixtures/strategy-lab.md`: 7 slides, 2 mermaid blocks, no props) SHALL complete in ≤ 20 s measured from after chromium launch, and its `deck.html` SHALL be ≤ 2.5 MB. `build` of the second fixture deck (`fixtures/business-2031/deck.md`: 23 slides, 4 mermaid blocks, deck-local effects and ambient props) SHALL complete in ≤ 60 s measured from after chromium launch, and its `deck.html` SHALL be ≤ 6 MB.

#### Scenario: Fixture within budget
- **WHEN** `deck3d build fixtures/strategy-lab.md` runs on the CI runner with chromium present
- **THEN** the post-launch wall time is ≤ 20 s and the output file size is ≤ 2,621,440 bytes

#### Scenario: Second fixture within budget
- **WHEN** `deck3d build fixtures/business-2031/deck.md` runs on the CI runner with chromium present
- **THEN** the post-launch wall time is ≤ 60 s and the output file size is ≤ 6,291,456 bytes

### Requirement: Build runs check
`build` SHALL run `check` on its output after rendering and print its findings, followed by one line `style: <styled>/<total> slides styled` where a slide counts as styled when it would not raise `style-defaults`; `build` SHALL exit 0 regardless of findings unless `--strict` is passed, in which case any finding fails the build. When chromium is unavailable, `build` SHALL still write the HTML, print `check skipped: chromium missing (<install command>)` and exit 0; under `--strict` an unrunnable check fails the build. `render` and `validate` SHALL never require a browser.

#### Scenario: Build without chromium
- **WHEN** `deck3d build talk.md` runs on a host without Playwright chromium (the parse step's harvest fixture is pre-cached)
- **THEN** `talk.html` exists, the skip line names the install command, and the exit code is 0 (non-zero with `--strict`)

#### Scenario: Build with findings
- **WHEN** `deck3d build talk.md` produces a deck with one fit error
- **THEN** the finding is printed, `talk.html` exists and the exit code is 0

#### Scenario: Strict build
- **WHEN** `deck3d build talk.md --strict` produces the same deck
- **THEN** the exit code is non-zero and the finding is printed

#### Scenario: Style summary line
- **WHEN** `deck3d build talk.md` runs on a 5-slide deck where two slides carry effect overrides and none carry props or built kinds
- **THEN** the output ends with `style: 2/5 slides styled`
