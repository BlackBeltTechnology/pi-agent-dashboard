## Context

See proposal.md (Why). The method this design productizes is recorded in the session's deck folder `~/Documents/Projektek/Zenit/RackInspect/Raktar360_prezi/AGENTS.md`. Its generators live in `deck3d/fx/reference/` (root `build_fx.py`, `warehouse-racks.src.js`; subdirs `slides/`, `art/`, `frame/`, `badge/`, `worlds/`, `scene/`, `logo/`). The deck is client material and is never copied into the repo.

Current deck3d facts that shape the design:

- **Settled camera:** the camera sits at the slide-local offset `(0.6, 0.6, distance)`, turned by the rail yaw (`packages/deck3d/src/runtime/camera.ts:9`, `:33-34`, `anchorFor` at `:38`). The camera is `PerspectiveCamera(42, …)` (`packages/deck3d/src/runtime/scene.ts:486`) with aspect = viewport w/h (`scene.ts:439`). The session's layer template hardcoded these; built-ins must derive them from the runtime.
- **Floor:** the floor plane sits at y −2.6 (`packages/deck3d/src/runtime/scene.ts:528`).
- **Local effects:** capped at 64 KiB (`packages/deck3d/src/fx/local.ts:22`) and sandboxed (`packages/deck3d/src/runtime/local-fx.ts:83`); `ctx.slide` at `local-fx.ts:50`.
- **Transitions:** local effects of the leaving slide are reclaimed when the transition lands (`pendingDispose`, `packages/deck3d/src/runtime/index.ts:410-411`). Far slide groups are culled. That is why the session's overlays reparented into the scene and shared state through `THREE.Cache.files`, which this design replaces with `persistent` effects.
- **Settled signal:** `FxHandle.setActive(active)` already signals settled vs flying (`packages/deck3d/src/fx/types.ts:71`, used by `video-screen`).
- **Overrides grammar is closed:** `definitions.overrides` has `additionalProperties: false` with keys `deck, effects, props, slides, nodes, edges` (`packages/deck3d/src/ir/schema.json`), and `overrides.deck` is `$ref: defaults`. Assets therefore get a new top-level key, `overrides.assets`; they are not a visual default.
- **Merge rules:** arrays replace on merge (`packages/deck3d/src/cli.ts:722-724`, deck3d-ir "Overrides survive re-parse"). Parse keeps prior overrides (`packages/deck3d/src/parse/derive.ts:185`).
- **Subtitle bug:** `OVERRIDE_RE` is single-line (`packages/deck3d/src/parse/markdown.ts:40`). `stripNonContent` keeps override lines on purpose (`markdown.ts:171`), and `extractSubtitle` (`markdown.ts:177`) and `extractBullets` do not skip them.
- **Corpus coverage gate:** the corpus-coverage test requires every `src/fx/*.meta.json` card on exactly one slide of `fixtures/business-2031` (`packages/deck3d/src/fx/__tests__/e56-fixture-fx-coverage.test.ts`).
- **Serve watching:** serve watches `deck.md` and `fx/`, and polls the `deck.json` digest (`packages/deck3d/src/serve/index.ts:236-260`).

## Goals / Non-Goals

**Goals:**
- A well-formed pptx imports to a deck whose settled slides match the reference renders. Constructs outside the supported matrix (deck3d-pptx-import spec) degrade visibly and are reported.
- Every creative decision is a recorded, replayable variant pick or note.
- No Python, no Docker, no native deps. Everything runs where deck3d runs (Node + optional chromium).

**Non-Goals:**
- Native charts, SmartArt, tables, equations, pptx animations/timings, speaker notes, hyperlinks. Raster fallback only.
- Round-tripping back to pptx.
- Auto-generating bespoke 3D worlds or hero scenes in code. They stay agent-authored local effects.
- Keynote/Google Slides input. Export to pptx first.

## Decisions

### D1 — TypeScript extraction: streaming `fflate` + `fast-xml-parser`
**Choice:**
- **Zip guards:** read the central directory first and reject on declared entry count/sizes. Then inflate each entry with fflate's streaming `Unzip`, counting actual bytes per entry and in total, and abort the stream the moment a limit or the 200:1 ratio is crossed. This guarantees no full inflation of a bomb, which a naive `unzipSync` would not.
- **XML:** a raw-byte pre-scan of each XML part (by content type or `.xml`/`.rels` name, after inflation, before parsing) rejects `<!DOCTYPE`. Binary media are never scanned. `fast-xml-parser` runs with `processEntities: false`.
- **Not a zip:** an OLE compound file (`D0 CF 11 E0`) holding an `EncryptionInfo` stream is reported as encrypted; any other non-zip is reported as "not a .pptx (OOXML) file" (e.g. a legacy `.ppt`).
- **Autofit:** text sizes use the `normAutofit` `fontScale` and `lnSpcReduction` the authoring application stored; fit is never recomputed. `spAutoFit` boxes use their stored extent. Remaining wrap drift is a font-metric issue handled by `widen`, font assets and `compare`.
- **Re-import identity:** a per-slide `fingerprint` (sha256 of normalised title + ordered item text). `--force` re-import matches first by fingerprint, then by title at the nearest position, keeps matched `sNN` ids, gives new slides fresh numbers, and warns on every moved or vanished id.
- **Modules** (`src/pptx/`): `zip.ts`, `theme.ts`, `xfrm.ts` (EMU → slide space, group offset/scale/rotation/flip composition), `text.ts`, `shapes.ts`, `pictures.ts`, `master.ts`, `fallback.ts`, `ref.ts`, `baseline.ts`, `stage.ts` (temp dir + rename).
- **Determinism:** ids are stable (`sNN`, `sNN-iMMM`), media are content-hash named, and JSON keys are sorted.

**Alternatives considered:**
- *python-pptx*: rejected per user decision.
- *jszip*: async and non-streaming size control.
- *DOM XML parsers*: entity/XXE history.

### D2 — Image decoding in a sandboxed chromium page
**Choice:** `art trace` / `art cutout`, contact sheets and reference crops decode in a Playwright page with:
- `javaScriptEnabled: false`;
- a `page.route('**')` that serves only the input bytes and aborts everything else;
- a 20 MB input cap.

Pixel buffers return to Node. Tracing itself is plain TS (flood fill → Moore contour → RDP → winding fix; port of `trace_art.py`), unit-tested on synthetic RGBA buffers without a browser. `art icon` parses SVG as data (fast-xml-parser) and never loads it in a browser; the flattener is a port of `svgflat.py`.

**Alternatives considered:** `pngjs` (PNG only), `sharp` (native).

**Determinism:** scoped to identical RGBA input. Traced outputs are files pinned as assets, so browser version drift cannot change a built deck.

### D3 — `overrides.assets` bundle
**Choice:**
- **IR key:** a new top-level key, so the closed `defaults` schema is untouched (deck3d-ir MODIFIED).
- **Scope:** only runtime inputs are assets: `layout.json`, media, fallback crops, traced JSON, fonts. Reference renders stay in `pptx/ref/` and are read only by `compare`, never embedded.
- **Font ids:** font assets use the `font-<slug>` id namespace, enforced by `validate`.
- **Stable import ids:** imported assets are `pptx-<part-path slug>`, so a re-import updates `path`/`sha256` in place and effect params never dangle. Assets the user added (no `pptx-` prefix) are never touched.
- **Render:** embeds sorted by id, inside one escaped JSON script block, with the 25 MB / 200 MB budget.
- **Runtime:** decodes images (`createImageBitmap`) and fonts (`FontFace` from the data URI) before building slides, then resolves `ready()`.
- **Access:** `ctx.assets.get(id)` for corpus and local effects (deck3d-effects / deck3d-local-effects MODIFIED).

**Alternatives considered:**
- *Raise the local cap*: still mixes data into code.
- *Sidecar files*: break the single-file offline guarantee (same reason as `--embed-video`).

### D4 — `layer` kind, `persistent` cards, and the five built-ins
**Choice:**
- **`replacesContent` card flag:** `slide-layer` declares it, so a slide that composes the layer does not build its native title, card, bullets or diagram, and those are not measured. Native content stays intact for the `native` fidelity variant.
- **`layer` kind:** effects that draw slide content on the content layer, above the backdrop pass. The `fx-content-layer` check rule applies to background and local effects only, so `layer` effects are legitimately exempt.
- **Persistent cards (`persistent: true`):**
  - deck-scope only;
  - created once after asset decode;
  - parented to the scene, not to a slide group, so culling and `pendingDispose` never touch them;
  - receive `transition({from,to,p})` every frame from the transition driver in `runtime/index.ts`.
- **Built-in cards:** the five built-ins are corpus cards (`src/fx/<id>.ts` + meta). Kind, cost and persistence are as in the deck3d-slide-layers card table. `source` is the repo URL and the licence MIT: the code is written fresh in-repo; the session code was agent-authored, and no client artwork ships in the package.
- **Coverage fixture:** `fixtures/business-2031` gains a small asset bundle (a synthetic layout, outline, polyline and chrome PNG generated by a test helper and committed as JSON/PNG under `fixtures/business-2031/assets/`). Each built-in is placed on exactly one slide to satisfy the coverage gate. The same stub bundle (copied to `assets/preview/`) powers `fx preview`.

**`slide-layer` placement:**
- Per frame it computes the contain-fit slide frame for the current viewport aspect against the slide aspect.
- For each layer depth `d` it computes the world-space plane that exactly fills that frame from the settled pose (`anchorFor()` + fov 42 + current aspect).
- Item quads are positioned on that plane with rotation and flip.
- Text renders per layer into an offscreen canvas sized `frameHeightPx × quality factor` (capped by tier).
- Each text item's projected rect and cap height are pushed into `measure()` as `layer-text`.
- The halo uses normal blending.

**`icon3d` / `art3d`:** the session's techniques (tube icons on glass cards, extrusion with a zero-normal fix). The `icon3d` entry animation is triggered by `setActive(true)`, not by tick gaps.

**`haze`:** gets a `floor` param.

### D5 — Unsupported constructs → reference crop
See the deck3d-pptx-import spec. The crop uses the item's rotated bounding rect. Without a reference render, the item is a placeholder rect plus a warning.

### D6 — Reference renders
These come from `--ref` user exports (preferred: true fonts) with the filename grammar in the spec, else `soffice --headless --convert-to pdf` + `pdftoppm -png -scale-to-x 1920 -scale-to-y -1`. The repo's Docker `document-converter` route (archive `render-pptx-preview`, dashboard-preview scope) is not used: deck3d must not need Docker.

### D7 — Variant loop and ownership
- **`style.json`:** an ordered `variants[]` array, a `round` counter, and a `pending` flag for crash detection.
- **`variants render`:** an in-memory merge per variant, render to temp HTML, snapshot sample slides, compose the contact sheet in chromium, and delete the temp HTML.
- **`variants pick`:**
  - reuses `overridesApply` (`cli.ts:727`) validation;
  - adds an ownership guard: for each scope array the fragment replaces, every effect or prop id present in the live deck must still be present, whether it came from a pick, the configurator or a hand edit; removal needs `--drop <id>` or `--replace-step <step>`;
  - writes in three steps, each via temp file + rename: style.json pending → deck.json → style.json final.
- **`variants note`:** records free text and bumps `round`.
- **`variants replay`:** applies picks in order through the same merge + guard, idempotently, and reports orphans.
- **Serve:**
  - `?variant=` renders in memory;
  - `V` is guarded like the existing key handler that ignores keys while a configurator input has focus;
  - while a variant is shown, the configurator's Save and Apply are disabled;
  - `style.json` and every `overrides.assets` path are added to the watch set;
  - rebuilds are deferred while `style.json` has `pending: true`, so a pick in progress is never served half-applied.
- **Persistent cards in the configurator:** not offered in the slide-scope add control (deck3d-configurator MODIFIED).

The skill, not the CLI, authors fragments.

### D8 — `compare`
For each slide:
1. snapshot at rest at the viewport;
2. crop to the slide frame: the slide aspect from `layout.json` contain-fitted into the viewport, the same definition `slide-layer` uses, so native decks are cropped identically;
3. resize the crop and the reference to 480 px wide;
4. compute luminance SSIM (8×8 windows, standard constants C1 = (0.01·255)², C2 = (0.03·255)²), averaged and rounded to 0.001; mean absolute RGB difference is informational.

`--transition` writes frames under `<out>/transitions/`. The default threshold of 0.85 will be calibrated in task 6.4. Acceptance passes `--viewport` explicitly.

### D9 — Tutorial skill
`packages/deck3d/.pi/skills/deck3d-from-pptx/SKILL.md` + `reference/steps.md`. Each step defines:
- inputs to read;
- how to author 2–4 fragments, carrying forward earlier effects;
- sample-slide selection;
- the question shape (`ask_user` select with a "free text" path; contact sheet opened via canvas; serve link in the message);
- the pitfalls checklist.

Reference renders are requested up front; without them, steps report snapshot review instead of scores. The final deliverable is rendered with `--embed-video` when any video screen is used. The native-path mapping is as specified. Headless mode is entered only via an explicit instruction in the run prompt, never inferred.

### D10 — Parser fix
Before subtitle and bullet extraction, collapse override comment spans:
- a `<!-- deck3d:` opener through the next `-->`, possibly across lines;
- including the bullet form `- <!-- deck3d: … -->`.

Each span is collapsed into a single override record and removed from content. `extractInlineOverride` consumes the records. The JSON-error behaviour is unchanged.

## Risks / Trade-offs

- **[Font metric drift between Office fonts and browser fallbacks]** → `widen`, font assets, and `fonts()` + `compare` reporting. The skill checks every multi-line box.
- **[Large decks bloat `deck.html`]** → asset budget; layer canvas capped per quality tier; `art cutout --max`. The `business-2031` fixture stays within its existing build budget (stub assets are a few KB).
- **[Untrusted input]** → D1/D2 guards; all rejections leave the target unchanged (staging).
- **[Persistent lifecycle is new runtime surface]** → a single driver hook; tested by the 100 ms capture scenario; no `THREE.Cache` use.
- **[Scope is large]** → four phases in tasks.md (phase 1 = sections 1a–1c), each ending green. The tutorial (phase 4) depends on all others.
- **[Ownership guard covers effect and prop ids only]** → other replaced arrays (e.g. `check.ignore`) follow plain array-replace; the skill teaches carrying them forward.
- **[Fingerprint matching can mis-pair two near-identical slides]** → it falls back to title + nearest position, and every remap is printed for review.

## Migration Plan

Additive. Ship as a deck3d minor version. Decks using new features require it, and older versions fail `validate` with unknown-field/effect errors. Rollback = previous package version. The Raktar360 deck is not migrated; porting it is the optional manual acceptance run (task 6.4).

## Open Questions

- ~~`compare` default threshold (0.85) and asset budget numbers~~ **Calibrated on the generated fixtures (task 6.4):** a faithful `slide-layer` rendition scores 0.907 against an independently drawn reference (plain HTML/CSS of the same layout); a mismatched slide scores < 0.85 (checker reference) and unrelated content < 0.3. The default stays **0.85**. The deck's output tone mapping dims pure white to ≈ 221 (mean RGB difference ≈ 20), which is why a faithful match lands near 0.9 rather than 0.99 — the skill says so. Asset budgets (25 MB warn / 200 MB error) held on the 4 MB and 200 MB fixtures. The real-deck acceptance run (#M1) is manual and stays open.
