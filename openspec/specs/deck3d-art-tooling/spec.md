# deck3d-art-tooling Specification

## Purpose
Turns pptx raster art and SVG icons into outline and polyline JSON that deck3d's built-in 3D effects can extrude or tube, with geometry rules that prevent filled holes and NaN shading.

## Requirements

### Requirement: Sandboxed image decoding
Commands that decode images (`art trace`, `art cutout`) SHALL decode inside a headless browser page with:
- scripts disabled;
- every request other than the one serving the input aborted;
- an input size cap of 20 MB.

SVG input SHALL be rasterised there, at a size given by `--size` (default 1024 px on the longest side). Without chromium these commands SHALL exit non-zero with the chromium install hint.

#### Scenario: SVG with external reference
- **WHEN** an SVG input references `https://example.com/x.png` and contains a `<script>`
- **THEN** the trace completes without any network request and without executing the script

### Requirement: art trace
`deck3d art trace <image> [-o out.json] [--palette #hex,…] [--min-area px] [--tolerance px]` SHALL convert an image into JSON polygons with holes, in image-pixel coordinates. Each polygon SHALL carry the palette colour it was classified to (nearest palette entry, or the dominant colour when no palette is given). Outer rings SHALL be counter-clockwise and holes clockwise. Regions smaller than `--min-area` SHALL be dropped. For identical decoded pixels and flags the JSON SHALL be byte-identical. Traced files are pinned as deck assets, so decoder differences between browser versions never change a built deck.

#### Scenario: Holes and winding
- **WHEN** a PNG of the text `Rap` is traced
- **THEN** the JSON has outer rings counter-clockwise, holes for the counters of `R`, `a` and `p` clockwise, and each hole is attached to its letter

#### Scenario: Two-colour wordmark
- **WHEN** a wordmark with dark `Rack` and orange `Inspect` (touching glyphs) is traced with `--palette #161e23,#f67519`
- **THEN** the dark and orange glyphs are separate polygons with their respective colours

### Requirement: art icon
`deck3d art icon <file.svg> [-o out.json]` SHALL parse the SVG as data, with no browser and no script execution. It SHALL flatten path commands `M L H V C S Q T A Z` (absolute and relative), lines, polylines, polygons, rects and circles into polylines in the SVG's viewBox space. Each polyline carries its stroke width and closed flag. Transforms on groups and elements SHALL be applied. External references SHALL be ignored with a warning. It SHALL reject an input that:
- is larger than 2 MB;
- contains `<!DOCTYPE`;
- has more than 50 000 elements;
- flattens to more than 500 000 points.

Entities SHALL never be expanded. Each rejection SHALL name the file and the limit.

#### Scenario: Hostile SVG rejected
- **WHEN** an SVG contains a DOCTYPE with nested entity definitions
- **THEN** `art icon` exits non-zero naming the file and the DOCTYPE rule, without expanding anything

#### Scenario: Arc flattened
- **WHEN** an SVG icon uses an elliptical arc `A` command
- **THEN** the output polyline follows the arc within 0.5 viewBox units

### Requirement: art cutout
`deck3d art cutout <image> --bg #hex [--split] [--max px] [-o dir]` SHALL make pixels near the background colour transparent (colour-to-alpha). With `--split`, it SHALL write one PNG per connected colour region, plus a JSON index of each region's bounding box in source pixels. `--max` SHALL downscale the longest side. It is used to cut master-slide corner art into `frame-chrome` layers.

#### Scenario: Corner layers
- **WHEN** a slide background with orange top-left and bottom-right corner bands on `#f8f8f8` is cut with `--split`
- **THEN** separate transparent PNGs exist for each band, and the index lists their source boxes
