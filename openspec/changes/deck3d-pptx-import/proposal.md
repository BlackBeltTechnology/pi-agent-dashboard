## Why

The "Zenit prezi" session (2026-10-10, `~/Documents/Projektek/Zenit/RackInspect/Raktar360_prezi`) turned an existing 13-slide `.pptx` into a 3D deck that matches the original pixel for pixel when the camera stops. It took about $77 of agent time and roughly 3,500 lines of one-off Python and JS under `fx/reference/`. It worked because of a repeatable method, not because of the deck: extract the layout, put each layer into the scene at its own depth, pin the frame to the camera, trace and extrude the brand art, turn icons into tubes, build background worlds from the slide text, verify against reference renders. Every step is hardcoded to that deck (`WIDEN`, `SKIP`, `RETEXT`, `WORLDS`, `HALO` tables, the pptx path). It also has to work around deck3d limits: the 64 KiB local-effect cap forces images into strips, overlays that survive a transition depend on a `THREE.Cache.files` hack, and an inline override comment is parsed as the slide subtitle.

deck3d needs a first-class pipeline that does this for any well-formed pptx, with an explicit supported-content matrix and visible fallbacks for the rest. Its creative decisions should be guided: generate variants, show them, ask, record the answer. That is the format of the session's own decisions (fidelity A/B/C, glass panel vs free-floating text, which 3D extras to build).

## What Changes

- **New `deck3d pptx import <file.pptx> [-o dir]`** (TypeScript, no Python, no Docker). It:
  - opens the OOXML zip with streaming size, ratio and zip-slip guards, rejects DOCTYPE, and stages output atomically;
  - extracts the theme and per-slide draw items in a 1920-wide slide space that keeps the deck's aspect: text, preset shapes, pictures with crop/rotation/flip, SVG icons, flattened groups, master chrome;
  - turns unsupported constructs (charts, SmartArt, tables, EMF/WMF, WordArt, …) into visible fallback items, cropped from the reference render, with a warning each;
  - takes reference renders from `--ref` user exports (PowerPoint/Keynote naming accepted) or LibreOffice + `pdftoppm` when present;
  - writes a baseline `deck.md` / `deck.json`.

  `--force` re-imports while keeping existing overrides. It matches slides by content fingerprint so an inserted slide never shifts tuning, and backs up the old `deck.json`. Reference renders are authoring inputs only and are never embedded.
- **New deck asset bundle `overrides.assets`**: id, path, sha256, mime. Assets are pinned, embedded once in id order as data URIs, and decoded before `ready()`. They are readable through `ctx.assets` by built-in and local effects. This ends the 64 KiB image-strip workaround (the code cap stays).
- **New effect kind `layer`** (content-layer effects), a **`replacesContent`** card flag (a slide-layer slide drops its native title/card/bullets), and a **`persistent`** card flag: deck-scope effects created once per deck, kept out of slide groups, with a `transition({from,to,p})` hook. This replaces the `THREE.Cache.files` hack.
- **New built-in effects**:
  - `slide-layer`: imported layout as layers at separate depths, contain-fit from the settled camera (≤ 2 px at any viewport and aspect), modes `screen`/`panel`/`free`, halo, `skip`/`retext`/`widen`. Its text is registered with `measure()`, so `check` covers it.
  - `frame-chrome`: persistent; master corner art flies out and in during transitions.
  - `art3d`: extruded traced art.
  - `icon3d`: SVG strokes become tubes, traced icons are extruded; optional glass card; the entry animation starts when the slide settles.
  - `haze`: fog planes with a `floor` edge.
- **New `deck3d art trace|icon|cutout`**:
  - `trace`: raster image to outline polygons with holes and correct winding;
  - `icon`: SVG to polylines, parsed as data;
  - `cutout`: colour-to-alpha plus region split, for cutting chrome layers.

  Images are decoded in a sandboxed chromium page with scripts and network off.
- **New variant loop**:
  - `style.json`: ordered steps, each with 2–4 variants, rounds, picks and notes;
  - `variants render`: contact sheet of reference vs variants;
  - `serve ?variant=` + `V` key: live preview; Save and Apply are disabled while a variant is shown;
  - `variants pick`: atomic, refuses to drop an earlier step's effects;
  - `variants note`: records a free-text answer and starts a new round;
  - `variants replay`: re-applies picks after a re-import;
  - `compare`: per-slide SSIM against the reference renders inside the slide frame, font-fallback report, `--transition` frames.
- **New skill `deck3d-from-pptx`**: a tutorial over nine steps:
  1. fidelity
  2. placement
  3. frame chrome
  4. brand art
  5. icons
  6. hero scenes
  7. background worlds + haze
  8. media
  9. transitions

  Each step: author variants → contact sheet on canvas + serve link → `ask_user` → pick or note → `build` + `compare`. It defines native-path behaviour and teaches the session's pitfalls.
- **Fix**: inline `<!-- deck3d: … -->` overrides are never read as the subtitle or a bullet. This covers the single-line, multi-line and bullet forms (`packages/deck3d/src/parse/markdown.ts`).

## Capabilities

### New Capabilities
- `deck3d-pptx-import`: safe OOXML extraction into `layout.json` + media, supported-content matrix, reference renders, baseline deck, tuning-preserving re-import.
- `deck3d-slide-layers`: asset bundle, persistent effects, and the built-in `slide-layer`, `frame-chrome`, `art3d`, `icon3d`, `haze` effects with their card definitions.
- `deck3d-art-tooling`: sandboxed decoding; `art trace` / `art icon` / `art cutout`.
- `deck3d-variant-loop`: `style.json` grammar, contact sheets, serve switching, pick/note/replay with ownership guard, `compare`.
- `deck3d-pptx-tutorial`: the `deck3d-from-pptx` skill's staged, variant-and-ask procedure.

### Modified Capabilities
- `deck3d-effects`: the card schema gains kind `layer` and the `persistent` flag; the corpus `ctx` gains `assets`; the `business-2031` coverage rule places persistent cards once at deck scope.
- `deck3d-local-effects`: the local-effect `ctx` gains the read-only `assets` accessor. The 64 KiB code cap is unchanged.
- `deck3d-ir`: the overrides grammar gains `assets[]`; validation resolves assets and rejects persistent effects outside deck scope.
- `deck3d-configurator`: the slide-scope add control does not offer `persistent` cards.
- `deck3d-serve`: the watch set gains `style.json` and asset files; rebuilds are deferred while a pick is pending.
- `deck3d-render`: `measure()` includes `layer-text` items, `fonts()` is added, and `ready()` waits for asset decode.
- `deck3d-skill`: the CLI command list gains the new commands; the markdown grammar guarantees override comments never become subtitle or bullet text.

## Impact

- **Code**:
  - New in `packages/deck3d/src/`: `pptx/`, `art/`, `variants/`, `compare/`, plus five built-ins in `fx/` and stub preview assets.
  - Changed: `ir/schema.json`, `render/index.ts`, `runtime/` (asset registry, `layer` kind, persistent lifecycle, measure/fonts), `fx/compose.ts`, `serve/index.ts`, `cli.ts`, `parse/markdown.ts`, and the `fixtures/business-2031` coverage deck (places each built-in once).
- **Skill**: new `packages/deck3d/.pi/skills/deck3d-from-pptx/`. The `deck3d` SKILL.md links to it.
- **Dependencies**: `fflate` (streaming unzip) and `fast-xml-parser` added to `@blackbelt-technology/pi-dashboard-deck3d` via pnpm. No image codec is added; decoding runs in the existing Playwright chromium. LibreOffice and `pdftoppm` are optional external tools.
- **Compatibility**: additive. Existing decks, local effects and the 64 KiB cap are unchanged. Parse output changes only for slides whose override comment was wrongly read as subtitle or bullet text, which is the bug.
- **Rollback**: revert the package version. Decks using the new built-ins, `layer` kind or `overrides.assets` fail `validate` on older deck3d with unknown-field/effect errors. No data migration.
- **Fixtures**: the synthetic pptx fixtures are generated at test time from XML templates (no committed binary decks). The Raktar360 deck is client material; it is used only for the manual acceptance run and never committed.

## Discipline Skills

- **security-hardening**: untrusted OOXML (zip bomb, zip slip, DOCTYPE/entities, encrypted containers) and untrusted SVG/raster decoding (sandboxed page, scripts and network off, size caps).
- **performance-optimization**: asset bundle size budgets (25 MB warn / 200 MB error); layer canvas sizes capped by quality tier; effect costs per built-in against the composition budget.
- **doubt-driven-review**: new public surface that is hard to change later: `overrides.assets`, `layer` kind, `persistent` cards, `style.json`, built-in params.
- **observability-instrumentation**: not applicable (offline CLI; findings surface as CLI warnings and `check`/`compare` reports).
