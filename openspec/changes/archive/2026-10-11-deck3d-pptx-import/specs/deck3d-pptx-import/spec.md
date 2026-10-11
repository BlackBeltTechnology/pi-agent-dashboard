## Purpose
Turns an existing `.pptx` into deck3d inputs: a deterministic slide-space layout description with extracted media, optional reference renders, and a baseline deck, safely and without Python or Docker.

## ADDED Requirements

### Requirement: Import command and outputs
`deck3d pptx import <file.pptx> [-o <dir>] [--ref <dir>] [--force]` SHALL write into `<dir>` (default: a directory named after the pptx basename beside it):
- `pptx/layout.json`;
- every referenced media part under `pptx/media/`, named `m-<first 12 hex of sha256>.<ext>` (lowercase extension), with its original bytes, identical parts stored once;
- a baseline `deck.md`;
- a baseline `deck.json`.

All outputs SHALL be staged in a temporary directory and moved into place only after every step has succeeded. On any failure `<dir>` SHALL be left exactly as before. The command SHALL exit 0 on success and non-zero with a one-line reason on failure.

#### Scenario: Fresh import
- **WHEN** `deck3d pptx import talk.pptx -o talk` runs on a valid 5-slide pptx
- **THEN** `talk/pptx/layout.json` lists 5 slides with ids `s01`..`s05`, every image item's media exists under `talk/pptx/media/`, `talk/deck.md` has 5 slides, and `deck3d validate talk/deck.json` exits 0

#### Scenario: Existing deck protected
- **WHEN** `talk/deck.md` already exists and import runs without `--force`
- **THEN** the command exits non-zero naming `talk/deck.md` and `talk/` is unchanged

#### Scenario: Failure leaves no partial state
- **WHEN** import fails while extracting the 40th media part
- **THEN** `talk/` contains no `pptx/` directory and no deck files that were not there before

### Requirement: Re-import keeps tuning
On first import, slide ids SHALL be assigned in order (`s01`, `s02`, …). Each slide's `fingerprint` in `layout.json` is the sha256 of its normalised title text plus the ordered text of its other items. With `--force` on an existing deck, import SHALL:
1. regenerate `pptx/`, `deck.md` and the derived part of `deck.json`;
2. give every new slide the id of the previous slide with an equal fingerprint, then of the previous slide with the same title at the nearest position. A slide with no match gets the next unused number. Every id that moved or vanished is listed in a warning.
3. copy the previous `deck.json` to `deck.json.bak`;
4. keep every existing `overrides` key;
5. add baseline override keys only where absent;
6. reconcile imported assets by id: every imported asset has a stable id derived from its package part name (`pptx-` + the part path slugified, e.g. `pptx-ppt-media-image7-png`; `pptx-layout` for the layout). A re-imported part keeps its id and gets its new `path` and `sha256`. Assets the user added (ids without the `pptx-` prefix) are never touched.
7. drop an imported asset whose part vanished, with a warning. If an effect param still references the dropped id, import SHALL fail without writing anything, listing every reference.

Other than the asset reconciliation in steps 6–7, every existing `overrides` key SHALL be kept.

#### Scenario: Inserted slide does not shift tuning
- **WHEN** a new slide is inserted before the old slide 3 in the pptx and `--force` re-import runs
- **THEN** the old slide 3 keeps id `s03` and its overrides, the inserted slide gets the next unused id, and stderr lists the inserted slide

#### Scenario: Changed image keeps its asset id
- **WHEN** `image7.png` is replaced by a new picture in the pptx and `--force` re-import runs
- **THEN** asset `pptx-ppt-media-image7-png` keeps its id, its `path` and `sha256` point to the new content-hash file, and effects referencing it still validate

#### Scenario: Configurator tuning survives
- **WHEN** a user applied `overrides.slides["s03"].camera.distance = 11` through the configurator and then runs `pptx import talk.pptx -o talk --force`
- **THEN** `overrides.slides["s03"].camera.distance` is still 11 and `talk/deck.json.bak` holds the previous file

### Requirement: Slide space and layout description
Slide space SHALL be 1920 units wide and `1920 × slideHeight / slideWidth` units high (1080 for 16:9, 1440 for 4:3). `layout.json` SHALL record that size, the theme colour scheme, the major/minor fonts, and per slide the draw items in z-order with stable ids `sNN-iMMM`.

Item kinds:
- `text`: rect, rotation, flips, anchor, insets, vertical flag, autofit mode, paragraphs with alignment, line spacing, spacing before/after, and runs (text, size in slide-space units after autofit font scale, bold, italic, underline, resolved hex colour, font);
- `rect`: rect, rotation, preset (`rect`, `line`, `ellipse`, `roundRect`), fill hex, alpha, line colour, line width;
- `img`: rect, rotation, flips, media path, crop fractions, and `svg` media path when an SVG alternative exists;
- `fallback`: see the next requirement.

Text sizes SHALL apply the font scale and line-spacing reduction stored by the authoring application in `normAutofit`, without recomputing fit. A shape-autofit (`spAutoFit`) box uses its stored extent.

Group transforms (offset, scale, rotation, flips) SHALL be composed into each child's rect and rotation. Items inherited from layout and master SHALL be marked `"origin": "master"`. The full-slide background picture SHALL be recorded as `background`, not as an item. The same pptx SHALL produce byte-identical `layout.json`.

#### Scenario: Theme colour resolved
- **WHEN** a run's colour is `schemeClr accent2` with `lumMod 75000`
- **THEN** the run's `color` in `layout.json` is the resolved hex value

#### Scenario: Rotated grouped icon
- **WHEN** an SVG icon sits inside a group rotated 90° whose child offset/extent differ from its frame
- **THEN** the icon's `img` rect and rotation in `layout.json` reproduce its position in the reference render within 2 slide-space units

#### Scenario: 4:3 deck
- **WHEN** a 4:3 pptx is imported
- **THEN** `layout.json` records a 1920×1440 slide space and item rects use it

#### Scenario: Deterministic
- **WHEN** the same pptx is imported twice into empty directories
- **THEN** both `layout.json` files are byte-identical

### Requirement: Supported content and visible fallback
Import SHALL map text boxes, placeholders, solid-filled preset shapes `rect`, `line`, `ellipse` and `roundRect`, pictures (PNG, JPEG, GIF, SVG), groups, and master/layout items. Everything else SHALL become a `fallback` item: charts, SmartArt, tables, OLE objects, EMF/WMF pictures, WordArt, other shape presets, gradient or picture fills, and picture effects other than crop. When a reference render exists, the fallback SHALL be an image cropped from the reference render at the item's bounding rect. Otherwise it SHALL be an outlined placeholder rect. Each fallback SHALL produce one warning naming the slide, item id and construct. A file that is not a zip SHALL fail. The reason names encryption when the file is an OLE compound file holding an `EncryptionInfo` stream, and otherwise says "not a .pptx (OOXML) file".

#### Scenario: Chart with reference
- **WHEN** slide 3 contains a chart and a reference render exists for slide 3
- **THEN** `layout.json` has a `fallback` item for the chart whose media is a crop of that render, and stderr warns `s03-i004 chart: raster fallback`

#### Scenario: Encrypted pptx
- **WHEN** the input is a password-protected pptx (an OLE compound file with an `EncryptionInfo` stream)
- **THEN** import exits non-zero with a reason naming encryption

#### Scenario: Legacy .ppt
- **WHEN** the input is a legacy binary `.ppt` renamed to `.pptx`
- **THEN** import exits non-zero with reason "not a .pptx (OOXML) file"

### Requirement: Reference renders
Import SHALL produce reference images `pptx/ref/sNN.png` from one of these sources, in order:
1. PNG or JPEG files in `--ref <dir>`. A file matches slide N when its basename (case-insensitive, extension removed) is one of `sNN`, `slideN`, `slide N`, `slide-N`, `slide_N`, or `N`, optionally preceded by any prefix ending in a space, `-` or `_`. Unmatched files and slides without a match SHALL each be listed in one warning.
2. LibreOffice (`soffice --headless`) plus `pdftoppm`, when both are on PATH.

When neither is available, or when `soffice` or `pdftoppm` exits non-zero, it SHALL print one warning (naming the failing tool and its exit status, if any) and continue without reference renders.

#### Scenario: PowerPoint export names
- **WHEN** `--ref exports/` contains `Slide1.PNG` … `Slide5.PNG` exported by PowerPoint
- **THEN** `pptx/ref/s01.png` … `s05.png` exist and no warning is printed

#### Scenario: No renderer available
- **WHEN** neither `--ref` nor `soffice` is available
- **THEN** import succeeds, `pptx/ref/` is absent, and stderr warns once that `compare` and raster fallbacks are unavailable

### Requirement: Baseline deck
The baseline `deck.md` SHALL contain one slide per pptx slide with pinned id `{#sNN}`. Content:
- title from the title placeholder (empty heading when none);
- subtitle from the first non-title text paragraph;
- bullets from the remaining body paragraphs.

The baseline `deck.json` overrides SHALL set:
- `deck.palette` from the theme;
- `deck.mode` (`light` when the background luminance > 0.5, else `dark`);
- `assets` entries for `layout.json` and every media file (including fallback crops), each with its stable `pptx-` id and its `sha256`.

Reference renders SHALL NOT be listed as assets. They are authoring inputs read from `pptx/ref/` by `compare` and never embedded in `deck.html`.

The baseline SHALL add no slide effects, so parse defaults apply.

#### Scenario: Baseline builds as a native deck
- **WHEN** the baseline is built with `deck3d build deck.md`
- **THEN** every slide renders its pptx title and text as a native deck3d slide, and `check` reports no errors

### Requirement: Untrusted input is contained
Import SHALL reject:
- a pptx whose zip directory lists more than 4000 entries;
- a pptx whose declared or actual uncompressed size exceeds 512 MiB in total;
- any entry whose declared or actual uncompressed size exceeds 128 MiB;
- any entry whose actual compression ratio exceeds 200:1.

Inflation SHALL stop as soon as an actual-size limit is crossed, so oversized data is never fully held in memory. Import SHALL reject entry names that are absolute or contain `..` segments, and SHALL never write outside `<dir>`. It SHALL reject any XML part (by content type or `.xml`/`.rels` name) containing `<!DOCTYPE` (checked on raw bytes before parsing), and SHALL not expand entities. Every rejection SHALL exit non-zero, name the offending entry and the limit, and leave `<dir>` unchanged.

#### Scenario: Zip bomb
- **WHEN** a pptx entry inflates past 128 MiB from 1 MiB compressed
- **THEN** import stops inflating at the limit, exits non-zero naming the entry and the limit, and `<dir>` is unchanged

#### Scenario: Zip slip
- **WHEN** a media entry is named `ppt/media/../../../evil.png`
- **THEN** import exits non-zero naming the entry and nothing is written outside `<dir>`

#### Scenario: Entity expansion
- **WHEN** `slide1.xml` contains a DOCTYPE with nested entity definitions
- **THEN** import exits non-zero naming `ppt/slides/slide1.xml`
