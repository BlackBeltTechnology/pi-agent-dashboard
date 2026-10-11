# Test Plan — deck3d-pptx-import

Stage: design   Generated: 2026-10-10

Hard-gate clarifications were resolved with the user:
- **Import performance:** no time budget, so there are no performance scenarios.
- **Panel tolerance:** ≤ 2 px applies to `screen`, `free`, and `panel` with tilt 0.
- **LibreOffice failure:** warn and continue, now stated in the spec.

All automated rows are **L1**: vitest under `packages/deck3d/src/**/__tests__/`. Browser-driven rows use the existing chromium helper (`src/__tests__/helpers/chromium.ts`, `describe.skipIf(!chromiumAvailable())`), the same pattern as `src/render/__tests__/f*.test.ts`. Synthetic pptx inputs are generated at test time by the new fflate fixture helper (task 2.1).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | deck3d-skill Markdown grammar | state (parser) | L1 | automated | `# {#s02}` followed directly by a single-line `<!-- deck3d: {"mode":"light"} -->`, no other text | `parse` | slide `s02` has `subtitle` undefined; `overrides.slides.s02.mode === "light"` |
| E2 | deck3d-skill Markdown grammar | EP (multi-line) | L1 | automated | slide with an override comment over 3 lines, then one paragraph `Hello` | `parse` | override recorded; `subtitle === "Hello"`; no `<!--` in any subtitle or bullet |
| E3 | deck3d-skill Markdown grammar | EP (bullet form) | L1 | automated | slide with bullets `- a`, `- <!-- deck3d: {"mode":"dark"} -->`, `- b` | `parse` | `bullets` equals `["a","b"]`; override `mode: "dark"` recorded |
| E4 | deck3d-skill Markdown grammar | error class | L1 | automated | multi-line override whose JSON is invalid | `parse` | exit ≠ 0; stderr names the slide and the JSON error |
| E5 | pptx-import Import command | happy path | L1 | automated | generated 5-slide 16:9 pptx | `pptx import talk.pptx -o talk` | `layout.json` slides `s01`..`s05`; every `img.media` file exists; `deck.md` has 5 `# … {#sNN}` headings; `validate talk/deck.json` exit 0 |
| E6 | pptx-import Import command | state | L1 | automated | `talk/deck.md` exists | import without `--force` | exit ≠ 0 naming `talk/deck.md`; recursive tree hash of `talk/` unchanged |
| E7 | pptx-import Slide space | determinism | L1 | automated | same generated pptx | import twice into two empty dirs | the two `layout.json` files are byte-identical; media names match `^m-[0-9a-f]{12}\.[a-z0-9]+$` |
| E8 | pptx-import Slide space | EP | L1 | automated | run colour `schemeClr accent2` + `lumMod 75000`, theme accent2 `#F66D03` | import | run `color` equals the hex computed by the spec'd HSL luminance modulation (golden value in test) |
| E9 | pptx-import Slide space | BVA (transform) | L1 | automated | SVG icon inside a group with `rot=5400000` (90°), `chOff≠off`, `chExt≠ext` | import | icon `img` rect and `rotation: 90` equal the hand-computed expected values within 2 units |
| E10 | pptx-import Slide space | EP (aspect) | L1 | automated | 4:3 pptx (sldSz 9144000×6858000) | import | `layout.json` `size` = `{w:1920,h:1440}`; a full-slide rect maps to 1920×1440 |
| E11 | pptx-import Slide space | EP (autofit) | L1 | automated | text box with `normAutofit fontScale="62500" lnSpcReduction="20000"`, run sz 2800; second box with `spAutoFit` | import | first run `size` = 28 pt × 2 × 0.625 = 35 units and line spacing reduced 20 %; second box rect equals its stored `ext` |
| E12 | pptx-import Supported content | decision table (construct × ref present) | L1 | automated | slide with chart, table, EMF picture, WordArt; run once with `--ref`, once without | import | 4 `fallback` items each time; with ref: media = crop of ref at the item's rect; without: placeholder rect; exactly 4 warnings, each `sNN-iMMM <construct>` |
| E13 | pptx-import Reference renders | EP (filename grammar) | L1 | automated | `--ref` dir: `Slide1.PNG`, `Deck - 2.png`, `slide_3.jpg`, `4.png`, `notes.png`; deck has 5 slides | import | `pptx/ref/s01..s04.png` exist; one warning listing unmatched `notes.png` and slide 5 |
| E14 | pptx-import Reference renders | EP (tool absent) | L1 | automated | PATH without `soffice`, no `--ref` | import | exit 0; `pptx/ref/` absent; exactly one warning |
| E15 | pptx-import Baseline deck | integration | L1 | automated | baseline from E5 | `deck3d build deck.md` (chromium) | build exit 0; `check` report has 0 `error` findings; every slide shows its pptx title text in `measure()` |
| E16 | pptx-import Re-import keeps tuning | state | L1 | automated | E5 deck plus `overrides.slides.s03.camera.distance = 11` | `import --force` | value still 11; `deck.json.bak` byte-equals the previous `deck.json` |
| E17 | pptx-import Re-import keeps tuning | state (identity) | L1 | automated | pptx regenerated with a new slide inserted before old slide 3 | `import --force` | old slide 3 content still has id `s03` with its overrides; the new slide gets `s06`; stderr lists the new slide |
| E18 | pptx-import Re-import keeps tuning | state (asset id) | L1 | automated | `image7.png` content replaced; an effect param references `pptx-ppt-media-image7-png` | `import --force` | asset id unchanged; `path` = new content-hash file; `sha256` updated; `validate` exit 0 |
| E19 | pptx-import Re-import keeps tuning | decision table (vanished part × referenced) | L1 | automated | part `image9.png` removed; case A unreferenced, case B referenced by an effect param | `import --force` | A: entry dropped + one warning, exit 0. B: exit ≠ 0 listing the reference; deck tree unchanged |
| E20 | slide-layers Deck asset bundle | decision table | L1 | automated | asset entries: stale sha, `../secrets.json`, duplicate id, `image/bmp`, font asset id `calibri`, png with id `font-x` | `validate` | one error per case naming `overrides.assets[i]` and the rule; a valid set gives exit 0 |
| E21 | slide-layers Deck asset bundle | determinism | L1 | automated | deck with 20 image assets | render, reverse the `overrides.assets` array, render again | two HTML files are byte-identical |
| E22 | slide-layers Deck asset bundle | BVA (size) | L1 | automated | sparse temp asset files totalling 25 MB, 25 MB + 1 B, 200 MB, 200 MB + 1 B | `render` | ≤ 25 MB: no warning; 25 MB + 1: warning; 200 MB: warning, HTML written; 200 MB + 1: exit ≠ 0, no HTML |
| E23 | slide-layers Assets ready before first frame | async convergence | L1 | automated | slide 4 with a 4 MB PNG asset drawn by `slide-layer` | `snapshot --slide 4` (chromium) | the PNG's pixels inside the image rect differ from the background (variance > threshold in test) |
| E24 | local-effects Runtime isolation | error class | L1 | automated | local fx calling `ctx.assets.get("nope")` in create; second local fx reading a valid image asset | load deck (chromium) | `effects().errors` has `{slide, effectId:"local:…", phase:"create"}` for the first; the second constructs and receives `width > 0` |
| E25 | slide-layers Built-in card definitions | static | L1 | automated | corpus cards | corpus test | kind/cost/persistent/`replacesContent` match the spec table; licence MIT; `source` is a URL; no `tags.topic`; parsing a markdown deck with no overrides yields none of the five ids |
| E26 | slide-layers slide-layer placement | BVA (tolerance) | L1 | automated | 16:9 slide: title, 3 bullets, image; `mode: free` | settled snapshot at 1920×1080 + `measure()` (chromium) | every `layer-text`/image rect within 2 px of its layout rect |
| E27 | slide-layers slide-layer placement | EP (viewport aspect) | L1 | automated | same slide | settled at 2000×987 | frame = 1754×987 centred (x0 = 123); items within 2 × 987/1080 = 1.83 px of mapped rects |
| E28 | slide-layers slide-layer placement | EP (slide aspect) | L1 | automated | 4:3 slide | settled at 1920×1080 | frame 1440×1080 at x0 = 240; items within 2 px |
| E29 | slide-layers slide-layer placement | decision table (mode × tilt) | L1 | automated | modes `screen`, `free`, `panel` tilt 0, `panel` tilt 0.2 | settled measure | first three meet ≤ 2 px; tilt 0.2 is not asserted (test documents the exemption) |
| E30 | slide-layers slide-layer params | EP | L1 | automated | `retext {"s06-i012":"Illustrative video"}`, `skip ["s06-i008"]` | settled measure | a `layer-text` item `s06-i012` has text "Illustrative video"; no record for `s06-i008` |
| E31 | effects card schema `replacesContent` | state | L1 | automated | baseline slide (native title + bullets) adds `slide-layer` | load + `measure()` | no `title`/`bullet` kinds for that slide; only `layer-text`; a slide without `slide-layer` still has native kinds |
| E32 | slide-layers Layer text is measurable | integration with check | L1 | automated | `widen {"s02-i003": 2000}` | `check` (chromium) | `error fit` finding naming `s02-i003`; exit ≠ 0 |
| E33 | slide-layers Fonts | decision table (font present × asset) | L1 | automated | run font `Calibri` missing from the browser; case A no asset, case B asset `font-calibri` (test TTF) | load | A: `fonts().fallbacks` = `["Calibri"]` once and `compare` prints `font-fallback Calibri`; B: `fallbacks` empty |
| E34 | ir IR is schema-validated; slide-layers Persistent effects | state | L1 | automated | `frame-chrome` in `overrides.slides.s02.effects` | `validate` | exit ≠ 0 naming `overrides.slides["s02"].effects[i]` and "deck-scope only"; at deck scope it validates and is absent from every slide's composed list |
| E35 | effects Reference deck presents the whole corpus | static | L1 | automated | `business-2031` with `frame-chrome` once in `overrides.effects` | coverage test | passes; adding a non-persistent id to `overrides.effects` fails it, naming the id |
| E36 | configurator Panel visibility and controls | state | L1 | automated | configurator open on the fixture deck (chromium) | open the add list in slide scope, then deck scope; change a `frame-chrome` param | slide scope list lacks `frame-chrome`, deck scope list has it; after the edit exactly one `frame-chrome` root exists in the scene, outside slide groups |
| E37 | art-tooling art trace | EP | L1 | automated | RGBA buffer rendered from text `Rap` | trace core | outer rings counter-clockwise (signed area > 0), 3 holes clockwise, each hole inside its parent glyph polygon |
| E38 | art-tooling art trace | EP (palette) | L1 | automated | wordmark buffer: dark `Rack` touching orange `Inspect`, `--palette #161e23,#f67519` | trace core | polygons carry exactly the two colours; no polygon mixes pixels of both classes |
| E39 | art-tooling art trace | determinism | L1 | automated | same RGBA buffer + flags | trace twice | byte-identical JSON |
| E40 | art-tooling art icon | BVA (geometry) | L1 | automated | SVG path `M10 10 A 20 10 30 0 1 50 40` | `art icon` | every output point lies within 0.5 units of the analytic ellipse |
| E41 | art-tooling art icon | EP (transforms) | L1 | automated | `<g transform="translate(5,5) rotate(90)">` with a line | `art icon` | output polyline equals the transformed coordinates |
| E42 | art-tooling art cutout | EP | L1 | automated | image: orange TL and BR bands on `#f8f8f8` | `cutout --bg #f8f8f8 --split` (chromium) | 2 transparent PNGs; index has 2 boxes matching the band extents within 1 px; background pixels alpha 0 |
| E43 | slide-layers art3d | visual-numeric | L1 | automated | traced `Rpe` outline with bevel | settled snapshot (chromium) | the pixel at the centre of each counter equals the background colour (± tolerance) |
| E44 | slide-layers art3d | invariant | L1 | automated | outline with collinear and duplicate vertices | build geometry in node (three) | every vertex normal has length 1 ± 1e-6 |
| E45 | slide-layers icon3d | state | L1 | automated | `icon3d` targets `s05-i003`; `slide-layer.skip` lists it | settled | one icon3d object at the item rect; no layer quad for `s05-i003` |
| E46 | slide-layers icon3d | state-transition | L1 | automated | slide 5 under a pinned `setTime`, no transition | sample entry-animation state over 30 frames | the entry animation runs once after `setActive(true)` and does not restart |
| E47 | slide-layers haze | invariant | L1 | automated | `haze` with default `floor` | build | the minimum y over all haze plane vertices ≥ the floor y (−2.6) |
| E48 | variant-loop style.json grammar | decision table | L1 | automated | steps with 1 variant, 5 variants, duplicate names, `picked:"C"`, an invalid fragment, a dangling sample slide | `validate deck.json` | errors for the first five, each naming the `style.json` path; dangling slide = warning, exit 0 when only it remains |
| E49 | variant-loop Variant contact sheet | integration | L1 | automated | step with A, B, C; samples `s02`, `s04`, `s99` (missing) | `variants render --step placement` (chromium) | `contact.png` is 2 rows × 4 columns (dimensions asserted); warning names `s99`; `deck.json` sha unchanged; no `*.html` left in the temp dir |
| E50 | variant-loop Pick | error class | L1 | automated | fragment sets `slide-layer.params.halo = 5` (range 0–1) | `variants pick` | exit ≠ 0 naming the param; both files byte-unchanged |
| E51 | variant-loop Pick ownership | decision table | L1 | automated | `s04` effects hold `god-rays` (configurator) and `slide-layer` (step placement); fragment omits both | `pick worlds A`; with `--drop god-rays`; with `--drop god-rays --replace-step placement` | 1st: exit ≠ 0 naming `god-rays` and `slide-layer` (step placement); 2nd: exit ≠ 0 naming `slide-layer` only; 3rd: succeeds |
| E52 | variant-loop Pick | state | L1 | automated | step with free-text answer | `variants note placement --note "like B without glass"` | `picked: null`, `note` stored, `round` incremented by 1 |
| E53 | variant-loop Replay | invariant (idempotent) | L1 | automated | deck with 3 picks applied | `variants replay` | `deck.json` byte-unchanged; with a pick key referencing a missing slide, it is reported and exit is 0 |
| E54 | variant-loop Compare | EP | L1 | automated | references = snapshots of the same deck at rest at the compare viewport | `compare` | every score ≥ 0.99 |
| E55 | variant-loop Compare | BVA (threshold) | L1 | automated | one reference replaced by a different image (score ≈ 0.6) | `compare`, then `compare --strict` | warns naming the slide, exit 0; with `--strict` exit ≠ 0 naming slide and score |
| E56 | variant-loop Compare | EP (frame crop) | L1 | automated | native 4:3 deck at 1920×1080 with a reference 1440×1080 | `compare` | the score uses only the 1440×1080 frame (bars changed to magenta do not change the score) |
| E57 | variant-loop Compare | EP | L1 | automated | 3-slide deck | `compare --transition -o out` | `out/transitions/` holds 3 frames per transition (25/50/75 %); no score lines for them |
| E58 | deck3d-skill CLI commands | static | L1 | automated | built CLI | `deck3d --help` | output contains each of the 16 command names listed in the spec scenario |
| E59 | pptx-tutorial Skill ships | static | L1 | automated | package `pi.skills` + skill files | skill discovery test (`e45-skill-ships` pattern) | both `deck3d` and `deck3d-from-pptx` resolve; `deck3d/SKILL.md` contains the string `deck3d-from-pptx` |
| E60 | pptx-tutorial Staged procedure | static (content) | L1 | automated | `deck3d-from-pptx/SKILL.md` + `reference/steps.md` | content test | the nine step ids appear in order; the native skip of steps 2/3/5, `--embed-video`, reference-render request, explicit headless rule and every pitfall bullet are present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | slide-layers Parallax in flight | state-transition | L1 | automated | slide with title + body layers, `mode: free`, `swing` | freeze the clock at 50 % of the fly (chromium) | the screen-space delta between title and body centres differs from the settled delta by > 4 px |
| F2 | slide-layers frame-chrome | state-transition (frame capture) | L1 | automated | 2 slides, neither suppressed; then a third slide in `suppress` | capture every 100 ms of deck time through each transition | first and last frames show all layers at rest offsets; each layer offset rises monotonically then falls; on the suppressed slide the settled frame has no chrome |
| F3 | slide-layers frame-chrome | invariant | L1 | automated | `frame-chrome` on a deck with a mirror floor | render the reflection pass | no frame-chrome object is visible to the reflection camera (layer mask asserted) |
| F4 | variant-loop Live switching | state | L1 | automated | `serve` + page `?variant=fidelity:B` (chromium) | press `V` twice, close the page | `deck.json` and `style.json` sha unchanged; rendered variant names cycle B→C→A |
| F5 | variant-loop Live switching | decision table (param × focus) | L1 | automated | page without `variant` param; page with param and a focused configurator input | press `V` | no rebuild request in either case |
| F6 | variant-loop Live switching | state | L1 | automated | page with `?variant=` and the configurator open | inspect Save / Apply | both `disabled`; notice text mentions `variants pick` |
| F7 | variant-loop Live switching | async convergence | L1 | automated | running `serve` | edit `style.json`; replace an asset file; set `pending:true` then false | a rebuild for each of the first two; none while `pending` is true; one after it clears |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pptx-import Untrusted input | fault (zip bomb) | L1 | automated | entry that inflates to 129 MiB from ~1 MiB (generated) | import | exit ≠ 0 naming the entry and the 128 MiB limit; instrumented inflated byte count ≤ limit + one chunk; tree unchanged |
| X2 | pptx-import Untrusted input | BVA (entry count) | L1 | automated | zips with 4000 and 4001 entries | import | 4000: proceeds past the zip stage; 4001: exit ≠ 0 naming the 4000 limit |
| X3 | pptx-import Untrusted input | BVA (ratio) | L1 | automated | entries at actual ratios 200:1 and 201:1 | import | 200:1 accepted; 201:1 rejected naming the entry and the ratio |
| X4 | pptx-import Untrusted input | fault (zip slip) | L1 | automated | entry `ppt/media/../../../evil.png`; entry `/abs.png` | import | exit ≠ 0 naming the entry; no file outside `<dir>` (temp-root scan) |
| X5 | pptx-import Untrusted input | decision table (part type) | L1 | automated | `slide1.xml` with nested-entity DOCTYPE; a PNG media part containing the bytes `<!DOCTYPE` | import | XML case: exit ≠ 0 naming `ppt/slides/slide1.xml`; PNG case: import succeeds |
| X6 | pptx-import Supported content | EP (container) | L1 | automated | OLE file with an `EncryptionInfo` stream; OLE legacy `.ppt` without it | import | reasons "encrypted" and "not a .pptx (OOXML) file" respectively; tree unchanged |
| X7 | pptx-import Import command | fault (abort mid-write) | L1 | automated | injected write failure on the 40th media file | import | exit ≠ 0; `talk/` has no `pptx/` and no new deck files; no staging dir left behind |
| X8 | pptx-import Reference renders | fault (tool failure) | L1 | automated | stub `soffice` on PATH that exits 3 | import | exit 0; one warning naming `soffice` and status 3; `pptx/ref/` absent |
| X9 | art-tooling Sandboxed decoding | fault (hostile SVG) | L1 | automated | SVG with `<script>` setting a marker and `<image href="https://example.com/x.png">` | `art trace` (chromium) | completes; route log shows zero external requests; the marker is never set |
| X10 | art-tooling art icon | BVA (caps) | L1 | automated | SVGs: 2 MB, 2 MB + 1 B, DOCTYPE, 50 000 elements, 50 001 elements, a path flattening to 500 001 points | `art icon` | at-limit inputs pass; each over-limit or DOCTYPE input exits ≠ 0 naming the file and the limit |
| X11 | art-tooling / variant-loop | fault (dependency absent) | L1 | automated | chromium unavailable (`x2-no-chromium` pattern) | `art trace`, `variants render`, `pptx import` | the first two exit ≠ 0 with the install hint; `pptx import` exit 0 |
| X12 | variant-loop Pick | fault (crash between writes) | L1 | automated | fault injection: exit after the `deck.json` rename, before the final `style.json` write | then run `variants render` | the command reports an interrupted pick naming the step and asks for a re-run |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | tasks 6.4 acceptance | end-to-end | — | manual-only | Raktar360 pptx (client material, outside the repo) | run the `deck3d-from-pptx` skill end-to-end at `--viewport 2000x987` | `compare` ≥ the calibrated threshold on ≥ 90 % of slides; nine steps recorded in `style.json` |
| M2 | pptx-tutorial Every step asks | subjective | — | manual-only | a real user session | walk all nine steps | [judgment: variants are meaningfully different, the contact sheet + serve link make the choice easy, nothing is decided without asking] |
| M3 | slide-layers frame-chrome / icon3d | aesthetic | — | manual-only | styled acceptance deck | watch transitions on real GPU | [judgment: chrome fly-out/in and icon entry read as polished, with no flicker] |

---

## Coverage summary

- Requirements covered: 42/42 (all ADDED/MODIFIED requirements across 12 delta files have at least one row; deck3d-serve watch set via F7)
- Scenarios by class: edge 60 · perf 0 (user: no budget) · frontend 7 · error 12 · manual 3
- Scenarios by level: L1 79 · L2 0 · L3 0
- Scenarios by disposition: automated 79 · manual-only 3

## New infra needed

- Synthetic pptx generator test helper (fflate + XML templates), task 2.1. No other new harness: chromium-driven vitest tests follow the existing `src/render/__tests__` pattern.
