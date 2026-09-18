# Test Plan — add-deck3d-presentation-package

Stage: design   Generated: 2026-09-18

Levels used: **L1** = vitest in `packages/deck3d/src/**/__tests__/*.test.ts`. Rows marked
**L1‑browser** are vitest suites that drive Playwright chromium against the rendered `deck.html`
(`describe.skipIf(!chromiumAvailable)`); they are still L1 (same runner, same package), not L3 —
the repo's `tests/e2e/` harness is the *dashboard* docker stack, which this standalone CLI package
does not need. **ci** = workflow-level assertion.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ir: Parse is deterministic | state-repeat | L1‑browser | automated | `fixtures/strategy-lab.md` (7 slides, 2 mermaid) | `parse` twice into two files in one test | `sha256(a) === sha256(b)`; `deck.json` contains no key matching `/time|date|path|Date/` |
| E2 | ir: Parse is deterministic (prior overrides input) | decision-table | L1 | automated | same md; case A: no `-o` target; case B: target with `overrides.slides["intro"].mode="light"`; case C: B + `--fresh` | `parse -o out.json` | A and C byte-identical; B differs only inside `overrides` (deep-diff outside `overrides` is empty) |
| E3 | design D1 slide ids | BVA on slug collisions | L1 | automated | md with titles `Ágensrajok`, `Agensrajok`, `Agensrajok`, `` (empty heading), `# Final {#pin}` | `parse` | ids `agensrajok`, `agensrajok-2`, `agensrajok-3`, `slide`, `pin` in order; every id matches `/^(?!deck3d-)[a-z0-9-]+$/` |
| E4 | skill: Markdown grammar (zero headings) | BVA (min slides) | L1 | automated | md body `hello\n- a\n- b` with no `#` | `parse` | exit 0; `slides.length === 1`; `slides[0].id === "slide"`; bullets `["a","b"]` |
| E5 | ir: Overrides survive re-parse | state-transition | L1 | automated | target with `overrides.nodes["arch/A"].shape="hexagon"`; md edited so slide `arch` gains one bullet | `parse -o target` | derived bullet count +1; `overrides.nodes["arch/A"].shape === "hexagon"` unchanged; exit 0 |
| E6 | ir: Override target vanished (orphan = warn) | state-transition (illegal edge) | L1 | automated | target with `overrides.nodes["arch/Z"]` where node `Z` removed from mermaid | `parse` then `validate` | parse exit 0; stderr line `warn orphan override overrides.nodes["arch/Z"]`; `validate` exit 0 with same warning; key still present in file |
| E7 | ir: Title rename without pin | state-transition | L1 | automated | target with `overrides.slides["old-title"]`; md title renamed | `parse` | exit 0; warning names `old-title` and suggests `{#old-title}`; `slides[]` has new slug; override kept |
| E8 | ir: Inline override clobbers deck.json (precedence) | decision-table | L1 | automated | md slide `<!-- deck3d: {"mode":"light"} -->`; target `overrides.slides[id].mode="dark"`, `.scene="orbits"` | `parse` | result `mode:"light"`, `scene:"orbits"`; warning names key `overrides.slides["<id>"].mode` |
| E9 | ir: Overrides grammar — arrays replace, objects merge | decision-table | L1 | automated | derived `slides[id].effects=["tokens","fog"]`; overrides `slides[id].effects=["starfield"]` and `slides[id].camera={distance:9}` | in-memory `merge(ir)` | merged effects `["starfield"]` exactly; camera `{…derived, distance:9}`; persisted `slides[]` unchanged (derived-only) |
| E10 | ir: Edit outside overrides detected (`derivedHash`) | state-transition | L1 | automated | valid `deck.json`; case A: edit `slides[0].title`; case B: edit `overrides.slides[id].mode` | `validate` | A: warning `edited outside overrides` + exit 0; B: no such warning |
| E11 | ir: IR is schema-validated | BVA + unknown key | L1 | automated | `overrides.slides[id].camera.distance = "far"`; `overrides.nodes[k].colour = "#fff"` (unknown key) | `render` | exit non-zero; stderr contains JSON path `overrides.slides["<id>"].camera.distance` and `expected number`; second case names `colour` as unknown; no `.html` written |
| E12 | ir: Reworded label | Triple | L1‑browser | automated | `overrides.nodes["arch/A"].label = "Ügyfél"` | `render` → `measure()` on slide `arch` | measurement row with `id:"A"` has `label:"Ügyfél"`; font subset in html contains glyph `Ü` |
| E13 | harvest: Flowchart shapes + edge kinds | equivalence partitioning | L1‑browser | automated | fixture flowchart using `[rect] ([stadium]) ((circle)) {diamond} {{hex}} (((double)))` and edges `--> -.-> ==>` with one label | `parse` | node `shape` fields exactly `rect,stadium,circle,diamond,hexagon,doublecircle`; edge kinds `normal,dotted,thick`; edge label text preserved |
| E14 | harvest: Node ids stable / edge ids with underscores | BVA on id scheme | L1‑browser | automated | flowchart nodes `L_A`, `B_C`, edge `L_A --> B_C` | `parse` twice | edge `{from:"L_A", to:"B_C"}` exactly once; identical across runs |
| E15 | harvest: Subgraph membership | Triple | L1‑browser | automated | `subgraph Core … end` with 2 nodes | `parse` | both nodes carry `group:"Core"`; others have no `group` |
| E16 | harvest: Sequence converted | order preservation | L1‑browser | automated | sequence with actors `U,S,D` and 5 messages (incl. one `-->>` dotted, one self-message `S->>S`) | `parse` | actors in declaration order; `messages.length===5`; ids `m0..m4`; kinds preserved; self-message `from===to` |
| E17 | harvest: Hungarian text round-trips | Unicode partition | L1‑browser | automated | node label `Felhasználó őrült űrhajó` | `parse` | label byte-equal in `deck.json` (NFC) |
| E18 | harvest: Unsupported type | Triple | L1‑browser | automated | slide with ```mermaid `gantt` | `parse` | exit 0; `slides[i].diagram === "none"`; stderr `warn unsupported diagram gantt slide <id>` |
| E19 | render: Deep link (1-based) + credits index | BVA | L1‑browser | automated | 3-slide deck, one CC-BY prop | open `deck.html#3`, `#4`, `#0`, `#5` | `#3` → slide 3; `#4` → `deck3d-credits`; `#0` and `#5` → slide 1 (clamped), no console error |
| E20 | render: Quality tiers vs explicit override | decision-table | L1‑browser | automated | rows: quality ∈ {low,medium,high} × overrides.effects ∈ {[], ["bloom"]} | `render` → inspect runtime `__deck3d.effects()` (composer pass list) | low+[] → no bloom pass; low+["bloom"] → bloom pass present + stderr `warn budget`; medium/high+[] → bloom present |
| E21 | effects: Composition budget | BVA | L1 | automated | `quality:low`, deck effects cost 2 + slide effects cost {3, 4, 7} | `render` | sums 5, 6 → no warning; 9 → stderr `warn budget slide <id> 9 > 6` and `check` report row `warn budget` |
| E22 | effects: Conflict | Triple | L1 | automated | slide effects `["depth-of-field","god-rays"]` (cards conflict) | `render` | exit non-zero; stderr names both ids and the slide id; no html |
| E23 | effects: Mode-incompatible skipped | Triple | L1 | automated | slide `mode:light`, effect with `modes:["dark"]` | `render` | exit 0; stderr `warn skipped <id> (dark only) slide <sid>`; effect absent from runtime list |
| E24 | effects: Card drives validation | BVA on params schema | L1 | automated | `starfield` params `density` ∈ {min−1, min, max, max+1} | `validate` | min/max exit 0; min−1 and max+1 exit non-zero naming `overrides.slides["<id>"].effects[0].params.density` |
| E25 | effects: Deterministic defaults | decision-table | L1 | automated | slides: title only; flowchart; sequence; kicker with word "security" | `parse` | each slide's `slides[].effects` equals the table row for its kind/keyword; two runs identical |
| E26 | effects: Override replaces defaults | Triple | L1 | automated | slide with derived defaults; `overrides.slides[id].effects=["aurora"]` | `parse` → merge | merged list `["aurora"]` only; re-parse keeps override |
| E27 | effects: Corpus size and licence audit | set-equality | L1 | automated | `src/fx/*.meta.json` | corpus test | ≥ 15 mockup ids + every listed port id present; every `licence ∈ {MIT, Zlib, CC0-1.0, BSD-2/3, OFL-1.1}`; every `source` is `https://`; `reference/effects.md` regenerated equals committed |
| E28 | effects: Non-permissive licence rejected | Triple | L1 | automated | card with `licence:"CC-BY-NC-SA-4.0"` | corpus/schema test | schema rejects card naming the licence enum |
| E29 | props: Prop selection lives in overrides — dangling node role | Triple | L1 | automated | `overrides.props[0].role="node:Foo"`, no node Foo | `validate` then `render` | validate exit 0 + warning naming prop + `Foo`; render exit 0; prop absent from embedded list |
| E30 | props: Hash mismatch | fault (tamper) | L1 | automated | cached GLB byte-flipped after `fetch` | `props fetch` (verify mode) and `render` | both exit non-zero naming the prop; no html written |
| E31 | props: Oversized model (inclusive MiB cap) | BVA | L1 | automated | mock server bodies of 8,388,608 and 8,388,609 bytes | `props fetch` | first accepted (cache file exists); second refused: stderr has actual size, cap, exit non-zero, no cache file |
| E32 | props: Prop budget warning | BVA | L1 | automated | 5 props / 10,485,760 B total vs 6 props; vs 5 props / +1 B | `validate` | 5 props exactly at cap: no warning; 6 props: warning with count+bytes, exit 0; over bytes: warning, exit 0 |
| E33 | props: `props fetch` writes the entry | Triple | L1 | automated | mock source, empty overrides | `props fetch mock robot --slide intro --role illustration` | `overrides.props[0]` has `source,id,licence,author,sha256,slide,role`; `validate` exit 0 with no warning |
| E34 | props: Licence credits automatic | decision-table | L1‑browser | automated | props with licences CC0, CC-BY-4.0, generated | `render` | CC0-only → no credits slide; CC-BY present → last slide id `deck3d-credits` listing author+licence; not present in `deck.json` |
| E35 | render: JSON inlined safely | injection partition | L1‑browser | automated | node label `</script><b>x` and label with U+2028 | `render` → open | page has no console error; `measure()` returns label text equal to input |
| E36 | render: Font subset from merged text | set-equality | L1 | automated | derived text without `ű`; override label adds `ű` | `render` twice | subset size grows; second html contains glyph `ű`; first does not |
| E37 | check: Legibility scaled by viewport | BVA | L1 | automated | measurements with cap heights 14, 13.99 at 1080; 9.34, 9.33 at 720 | `rules.legibility` | 14 pass / 13.99 warn; 9.34 pass / 9.33 warn (threshold 14·720/1080 = 9.33̅) |
| E38 | check: Overlap IoU | BVA | L1 | automated | two rects IoU 0.1 and 0.1001 | `rules.overlap` | 0.1 → no finding; 0.1001 → `error overlap` naming both ids |
| E39 | check: Fit safe margin | BVA | L1 | automated | 1920×1080, margin 4 % → right edge limit 1843.2; rect right 1843, 1844 | `rules.fit` | 1843 pass; 1844 `error fit … right 1844px > 1843px` with suggestion `overrides.slides["<id>"].diagram.scale` |
| E40 | check: Suggestions are override keys | property test | L1 | automated | every finding kind × sample measurement | `rules.*` | every `suggestion` matches `/^overrides\./` and resolves in `schema.json` |
| E41 | check: Default viewports + two-viewport grouping | Triple | L1‑browser | automated | fixture html; run without `--viewport`, then `--viewport 1920x1080` | `check -o r.json` | default report has viewport groups `1920x1080` and `1280x720`; explicit run has one group |
| E42 | check: Clean deck | Triple | L1‑browser | automated | `fixtures/strategy-lab.md` built | `check` | zero findings; exit 0 |
| E43 | skill: Grammar error | Triple | L1 | automated | slide with `<!-- deck3d: {mode: light} -->` (invalid JSON) | `parse` | exit non-zero; stderr names slide id and JSON error position |
| E44 | skill: One-shot build | Triple | L1‑browser | automated | `talk.md` | `build talk.md -o talk.html` | `talk.json` + `talk.html` exist; `talk.json` byte-equal to `parse talk.md` |
| E45 | skill: Skill and CLI ship together | Triple | L1 | automated | package.json | test | `pi.skills` lists `.pi/skills/deck3d`; `bin.deck3d` resolves; `SKILL.md` frontmatter `name: deck3d` |
| E46 | ir: Field reference documented | set-equality | L1 | automated | `schema.json` descriptions | generated `reference/ir-fields.md` vs committed | equal; every schema leaf appears once |
| E47 | effects: Catalogue in sync | set-equality | L1 | automated | cards | generated `reference/effects.md` vs committed | equal; every id present |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | render: Build budget | threshold | L1‑browser | automated | `build fixtures/strategy-lab.md` (7 slides, 2 mermaid, no props) | wall time after chromium launch ≤ 20 s | single run, CI runner |
| P2 | render: Build budget (size) | threshold | L1 | automated | same output | `stat(deck.html).size ≤ 2,621,440` | single run |
| P3 | render: Render is deterministic | timed repeat | L1 | automated | same `deck.json` | 3 renders byte-identical and each < 5 s (no browser) | single test |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | render: Measurement is stable | convergence | L1‑browser | automated | fixture html, slide `arch`, `setTime(1.7)` | `await ready(); measure()` ×2 | deep-equal results; every rect finite |
| F2 | render: Render loop tolerates hidden tabs | state-transition | L1‑browser | automated | headless page, `document.hidden === true` | `setTime(0)` → `setTime(2.2)` → `measure()` | animated message rect differs between t values (loop advanced while hidden) |
| F3 | render: Lifted message leaves frame at peak | Triple | L1‑browser | automated | sequence slide with `overrides.slides[id].diagram.scale=2.5` | `check` | `error fit` row with `t` equal to one of `peaks()` values, not `t=0` |
| F4 | render: Hungarian titles render intact | glyph-count | L1‑browser | automated | title `Ágensrajok űrhajó őre` | render → runtime `__deck3d.debug.titleGlyphs()` | glyph mesh count equals non-space char count (22); no `earcut` console warning |
| F5 | render: Label on round node | geometric | L1‑browser | automated | stadium node `Felhasználó` | `measure()` | label rect fully inside viewport and `occlusion` rule finds no hit other than own node |
| F6 | render: Light and dark labels | decision-table | L1‑browser | automated | same slide `mode:dark` / `mode:light` | `measure()` label colour + outline | dark: fill `P.fg`, outline `P.bg`; light: inverted; both `toneMapped:false` |
| F7 | render: Message order animation | order invariant | L1‑browser | automated | sequence with 5 messages, pulse period 1.1 s | `setTime(k·1.1)` for k=0..4 | lifted group id at step k is `m<k>` |
| F8 | render: Offline open | fault (network blocked) | L1‑browser | automated | `deck.html` served with Playwright `route` aborting every non-document request | open + `ready()` | zero failed requests; slide 1 title glyphs > 0 |
| F9 | render: Byte-identical re-render (with props cache) | state-repeat | L1‑browser | automated | IR with 1 CC0 prop, cache warm | `render` ×2 | identical bytes |
| F10 | render: aesthetics parity with the strategy lab | visual/subjective | — | manual-only | fixture deck vs lab screenshots in `mockup/README.md` | human compares 7 slides | [judgment: "looks the same or better" — no automatable observable] |
| F11 | render: contrast rule on real GPU | visual/subjective | — | manual-only | fixture on a real GPU browser | human reads `check` contrast warnings vs perceived legibility | [judgment: GPU-dependent, warn-only by design] |
| F12 | effects: `fx preview` thumbnails | visual/subjective | — | manual-only | `fx preview <id>` for each v1 id | human inspects PNGs | [judgment: effect recognisable, no black frame] |
| F13 | props: Two props, same visual language | visual/subjective | — | manual-only | two props `restyle:palette` | human snapshot | [judgment: material harmony] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | harvest: No browser available | fault (missing dep) | L1 | automated | `PLAYWRIGHT_BROWSERS_PATH` pointed at empty dir | `parse` of md with mermaid | exit non-zero; stderr names chromium and contains `npx playwright install chromium` |
| X2 | render: Build without chromium | fault (missing dep) | L1 | automated | same env; md with **no** mermaid | `build notes.md` | `notes.html` exists; stderr `skip check: chromium missing (npx playwright install chromium)`; exit 0; with `--strict` exit non-zero |
| X3 | harvest: Syntax error in a supported type | fault (bad input) | L1‑browser | automated | ```mermaid `flowchart TD\nA --> ` | `parse` | exit non-zero; stderr has slide id and mermaid error text; no `deck.json` |
| X4 | harvest: Harvest hangs | fault (delay) | L1‑browser | automated | harness page stubbed to never resolve (test hook `DECK3D_HARVEST_STALL=1`), timeout lowered via `DECK3D_HARVEST_TIMEOUT_MS=500` | `parse` | exit non-zero within 2 s naming slide + `timeout`; no lingering chromium process (pid gone) |
| X5 | check: timeout per viewport | fault (delay) | L1‑browser | automated | deck whose `ready()` never resolves (test hook), `DECK3D_CHECK_TIMEOUT_MS=500` | `check` | exit non-zero naming viewport `1920x1080` + `timeout`; browser closed |
| X6 | props: Offline search (timeout) | fault (delay) | L1 | automated | mock Poly Pizza endpoint that stalls; `DECK3D_HTTP_TIMEOUT_MS=200` | `props search robot` | returns vendored rows within 1 s; one stderr line `online source skipped (timeout)`; exit 0 |
| X7 | props: Offline search (abort / unconfigured) | fault (abort) | L1 | automated | endpoint returns ECONNREFUSED; and separately no `POLY_PIZZA_KEY` | `props search robot` | vendored rows; notice line; exit 0 in both |
| X8 | props: Generate fallback unavailable | fault (missing dep) | L1 | automated | `PATH` without `python3` | `props generate --from-image x.png --name y` | exit non-zero; stderr contains `pip install gradio_client`; no file in `.deck3d/props/` |
| X9 | props: Non-glTF download | fault (bad input) | L1 | automated | mock body `<html>` with `Content-Type: model/gltf-binary` | `props fetch` | exit non-zero `not a glTF/GLB`; no cache file |
| X10 | props: `.gltf` with external URIs | fault (bad input) | L1 | automated | `.gltf` referencing `bin/model.bin` | `props fetch` | exit non-zero naming the external URI (self-containment) |
| X11 | ir: Bad edit fails before render | fault (bad input) | L1 | automated | `deck.json` with trailing comma (invalid JSON) | `validate`, `render` | both exit non-zero with JSON position; no html |
| X12 | harvest: Engine upgrade breaks ids | regression guard | L1‑browser | automated | committed harvest fixture snapshot | fixture test | current harvest deep-equals snapshot; a mismatch message names `mermaid` pin |
| X13 | render: cache miss on props | fault (missing file) | L1 | automated | IR with prop, `.deck3d/props/` deleted | `render` | exit non-zero naming prop and `deck3d props fetch`; no html |

---

## Coverage summary

- Requirements covered: 40/40 (every `### Requirement` across 6 specs + design D1 id/merge rules + the 7 gap-fill clauses)
- Scenarios by class: edge 47 · perf 3 · frontend 13 · error 13 — total 76
- Scenarios by level: L1 40 · L1‑browser 32 · L3 0 · ci 0
- Scenarios by disposition: automated 72 · manual-only 4

## New infra needed

- **Chromium-gated vitest suite** in `packages/deck3d`: `describe.skipIf(!chromiumAvailable())` helper + a shared `launch()` fixture; CI job installs `npx playwright install chromium --with-deps` for this package (workflow row; the runner otherwise lacks chromium — X1/X2 assert the skip path). Harness glue exemplar: `tests/e2e/*.spec.ts` (Playwright API usage only; no docker harness).
- **Test hooks** (env-only, documented in `packages/deck3d/AGENTS.md`): `DECK3D_HARVEST_TIMEOUT_MS`, `DECK3D_CHECK_TIMEOUT_MS`, `DECK3D_HTTP_TIMEOUT_MS`, `DECK3D_HARVEST_STALL` — needed for X4/X5/X6 without 60–120 s waits.
- **Mock HTTP server** (node `http`, in-test) for props fetch/search rows E31, E33, X6, X7, X9, X10.
- Runtime debug surface `__deck3d.effects()` / `__deck3d.debug.titleGlyphs()` for E20/F4 (read-only, ships in html; small).
