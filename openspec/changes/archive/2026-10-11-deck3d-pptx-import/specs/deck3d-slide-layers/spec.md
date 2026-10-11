## Purpose
Lets a deck carry pinned binary/JSON assets inside its single offline HTML. Provides built-in effects that rebuild an imported pptx inside the 3D scene: layout layers, master frame chrome, extruded art, 3D icons and haze. Stopped slides match the original; slide changes move through real 3D space.

## ADDED Requirements

### Requirement: Deck asset bundle
`overrides.assets` SHALL accept entries `{ id, path, sha256, mime }`. `id` matches `^[a-z0-9][a-z0-9._-]{0,127}$`. `path` is relative to the deck directory and SHALL resolve inside it. `mime` is one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `application/json`, `text/plain`, `font/ttf`, `font/otf`. `validate` and `render` SHALL reject:
- a missing file;
- a path escaping the deck directory;
- a duplicate id;
- a disallowed mime;
- a `sha256` mismatch.

Each rejection SHALL name the override path and file. `render` SHALL embed every listed asset once, in ascending `id` order, with its original bytes, as a `data:` URI inside the HTML, with `<` escaped. The same `deck.json` and asset bytes SHALL give byte-identical HTML, whatever the order of entries in `overrides.assets`. `render` SHALL warn when the summed asset size exceeds 25 MB and fail above 200 MB.

#### Scenario: Stale asset hash
- **WHEN** `pptx/media/m-0123456789ab.png` changes after its hash was pinned
- **THEN** `validate` exits non-zero naming `overrides.assets[i].sha256` and the file, and `render` writes no HTML

#### Scenario: Path escape
- **WHEN** an asset path is `../secrets.json`
- **THEN** `validate` exits non-zero naming the entry and "outside the deck directory"

#### Scenario: Byte-identical regardless of entry order
- **WHEN** a deck with 20 image assets is rendered, its `overrides.assets` array is reversed, and it is rendered again
- **THEN** both HTML files are byte-identical

### Requirement: Assets are ready before the first frame
The runtime SHALL decode every image and font asset before building slides. `__deck3d.ready()` SHALL resolve only after decoding finishes. Effects SHALL obtain an asset synchronously by id through `ctx.assets.get(id)` as a decoded bitmap (images), a parsed object (JSON), text, or a registered font family name (fonts). An unknown id SHALL throw, which disables that effect for that slide and records an effect error.

#### Scenario: Snapshot shows images
- **WHEN** `deck3d snapshot deck.html --slide 4` runs on a deck whose slide 4 shows a 4 MB image asset
- **THEN** the PNG contains the image, not an empty frame

### Requirement: Built-in card definitions
The built-in effects SHALL ship as corpus cards with these properties:

| id | kind | cost | modes | persistent |
|---|---|---|---|---|
| `slide-layer` | `layer` | 2 | both | no (`replacesContent: true`) |
| `frame-chrome` | `layer` | 1 | both | yes |
| `art3d` | `layer` | 1 | both | no |
| `icon3d` | `layer` | 1 | both | no |
| `haze` | `background` | 1 | both | no |

Every card SHALL have:
- `source`: the repository URL of the module;
- `licence`: `MIT`;
- `conflicts`: `[]`;
- no `tags.topic`, so parse never picks them by default.

#### Scenario: Layer replaces native content
- **WHEN** a baseline slide with a native title and bullets composes `slide-layer`
- **THEN** the native title, card and bullets are not built, and `measure()` lists only `layer-text` items for that slide

#### Scenario: Never auto-picked
- **WHEN** a markdown deck without overrides is parsed
- **THEN** no slide's derived effects contain any of the five built-ins

### Requirement: slide-layer reproduces the imported layout
The built-in `slide-layer` effect SHALL draw one slide of a `layout.json` asset, selected by params `layout` (asset id) and `slide` (`sNN`). It renders as up to four layers: body, icon, title, image. Each layer sits at its own depth toward the camera (param `depths`, defaults body 0, icon 0.6, title 0.9, image 1.2).

The **slide frame** is the slide aspect (from `layout.json`) contain-fitted into the current viewport: centred and scaled to the largest size that fits. `compare` uses the same definition. Placement SHALL map that frame into the scene from the slide's settled camera pose, and every item is placed by projecting its slide-space rect (with rotation and flips) through that pose at its layer's depth. At rest, in modes `screen` and `free` and in mode `panel` with `panel.tilt` 0, every item's rendered bounding box SHALL differ from its mapped rect by at most 2 px × (frame height / 1080), at any viewport size and for any slide aspect. A tilted panel is a deliberate 3D look and is exempt.

Params:
- `mode`: `screen` (pinned to the camera), `panel` (on a glass panel in the scene; params `panel.material`, `panel.tilt`), `free` (free-floating in the slide group);
- `halo` (0–1): a normal-blended halo behind text;
- `skip`: item ids not drawn;
- `retext`: item id → replacement text;
- `widen`: item id → extra slide-space units of box width.

With a `mode` other than `screen`, layers SHALL move with the slide during transitions, producing parallax between depths.

#### Scenario: Settled frame matches layout at 16:9
- **WHEN** a 16:9 slide with a title, three bullets and an image is rendered with `mode: free` and snapshotted at rest at 1920×1080
- **THEN** every item's bounding box differs from its `layout.json` rect by at most 2 px

#### Scenario: Wide viewport
- **WHEN** the same slide is snapshotted at rest at 2000×987
- **THEN** the frame is 1754×987, centred, and every item lies within 2 × 987/1080 px of its mapped rect

#### Scenario: 4:3 deck
- **WHEN** a 4:3 slide is snapshotted at rest at 1920×1080
- **THEN** the frame is 1440×1080, centred, and items match their mapped rects within 2 px

#### Scenario: Tilted panel is exempt
- **WHEN** a slide uses `mode: panel` with `panel.tilt` 0.2
- **THEN** the 2 px rule is not asserted for that slide, and with `panel.tilt` 0 it is

#### Scenario: Parallax in flight
- **WHEN** a snapshot is taken halfway through a `swing` transition into that slide
- **THEN** the title and body layers are displaced relative to each other compared with the settled frame

#### Scenario: Retext and skip
- **WHEN** params set `retext: { "s06-i012": "Illustrative video" }` and `skip: ["s06-i008"]`
- **THEN** the settled frame shows the new caption and does not draw item `s06-i008`

### Requirement: Layer text is measurable
`slide-layer` SHALL register every drawn text item with the deck's measurement hook (kind `layer-text`, id = item id). The record carries its projected screen rect and its cap height. That way `check`'s fit, legibility, overlap and contrast rules apply to imported text exactly as to native labels. Rects SHALL track the layer through transitions.

#### Scenario: Overflowing imported text is caught
- **WHEN** a `widen` param pushes a text item past the viewport's right edge
- **THEN** `check` reports an `error fit` finding naming the item id

### Requirement: Fonts
`slide-layer` SHALL draw text in the run's font when the browser has it. Otherwise it SHALL use a deck font asset (mime `font/ttf` or `font/otf`) whose id is `font-` followed by the font name lowercased, with every run of characters outside `[a-z0-9]` replaced by `-`, when present. `validate` SHALL reject a font asset whose id lacks the `font-` prefix, and a non-font asset whose id has it. Otherwise it SHALL use the deck's default font and record the font name once in `__deck3d.fonts().fallbacks`.

#### Scenario: Missing font reported
- **WHEN** a run uses `Calibri`, the browser lacks it and no `calibri` asset exists
- **THEN** `__deck3d.fonts().fallbacks` contains `Calibri` once and `compare` prints `font-fallback Calibri`

### Requirement: Persistent effects and frame-chrome
A card with `persistent: true` SHALL be listed only in deck-scope `overrides.effects`. Unlike other deck-scope effects, it is never prepended to slide effect lists. `validate` SHALL reject it under `overrides.slides[*].effects`, naming the path. The runtime SHALL create it once per deck load, keep it outside every slide group (so slide culling and per-slide disposal never touch it), and call its optional `transition(state)` hook every frame, with:
- `state.from` and `state.to`: slide indices;
- `state.p`: transition progress, 0–1;
- `state.p = 1` and `from = to` when settled.

`frame-chrome` SHALL draw camera-pinned image layers from asset ids. Each layer has a screen corner anchor, size relative to viewport height, fly vector, delay, speed and easing. Its `suppress` param lists slide ids where the chrome stays hidden. Driven by `transition`, the leaving layers SHALL fly out during the first part of the move and the arriving layers fly in before it ends, so the chrome is never absent at both the start and the end of a move. Its objects SHALL be excluded from the floor reflection.

#### Scenario: Persistent effect on a slide is rejected
- **WHEN** `overrides.slides["s02"].effects` lists `frame-chrome`
- **THEN** `validate` fails naming `overrides.slides["s02"].effects[i]` and "deck-scope only"

#### Scenario: No pop on arrival
- **WHEN** frames are captured every 100 ms through a transition between two slides, neither suppressed
- **THEN** the chrome is fully present in the first and last captured frames, and each layer's offset moves monotonically out and then in between them

### Requirement: art3d extrudes traced art
The built-in `art3d` effect SHALL extrude an outline asset (polygons with holes, as written by `art trace`). Params: depth, bevel, per-polygon colour or vertical gradient, placement (`x y z scale`), sway amplitude, speed, and an optional sweep highlight. Holes SHALL render open. No vertex SHALL have a zero-length normal.

#### Scenario: Letter holes stay open
- **WHEN** a wordmark containing `R`, `p`, `e` is extruded with bevel
- **THEN** the counters of `R`, `p` and `e` render as holes in the snapshot

#### Scenario: No zero normals
- **WHEN** a traced outline with collinear and duplicate vertices is extruded
- **THEN** every vertex normal of the built geometry has length 1 ± 1e-6

### Requirement: icon3d builds icons as 3D objects
The built-in `icon3d` effect SHALL build an icon from either:
- an `art icon` polyline asset: tubes with radius = stroke width / 2, rounded at joints and ends; or
- an outline asset: extruded.

It SHALL place the icon at a slide-space rect projected like `slide-layer`. It MAY seat the icon on a glass card (`card: true`, with rim colour). The entry animation (spin + flash) SHALL start when the slide becomes settled (the runtime's active signal turns true), never from frame-timing gaps. An idle animation (sway, bob, periodic flash) follows. An item drawn by `icon3d` SHALL be listable in `slide-layer.skip` so it is not drawn twice.

#### Scenario: Icon replaces flat glyph
- **WHEN** `icon3d` targets item `s05-i003` and `slide-layer` skips it
- **THEN** the settled frame shows one 3D icon at the item's rect and no flat copy

#### Scenario: Entry plays once per arrival
- **WHEN** the deck renders slide 5 under a pinned `setTime` clock with no transition
- **THEN** the entry animation does not replay on later frames

### Requirement: haze fades distant worlds
The built-in `haze` effect SHALL place background-coloured soft-edged translucent planes between the slide and its distant background. Params: layer count, near/far distance, density, drift, colour override, and `floor` (the world y where the planes' bottom edge sits, default the floor height). Planes SHALL not extend below `floor`.

#### Scenario: No floor seam
- **WHEN** `haze` is added to a slide in light mode
- **THEN** the snapshot shows no hard horizontal edge where the haze planes meet the floor

### Requirement: Built-ins are previewable
`fx preview <built-in>` SHALL render the effect against a stub asset bundle that ships with the package (a sample layout, outline, polyline and chrome image), so every built-in has a catalogue preview.

#### Scenario: Preview without a deck
- **WHEN** `deck3d fx preview slide-layer -o p.png` runs outside any deck directory
- **THEN** a non-black PNG showing the sample layout is written
