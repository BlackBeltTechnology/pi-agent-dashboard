## Purpose

`pi-photocraft replace-region` performs generative part-replacement with pixel-exact locality: PhotoCraft selects and crops a region, nano-banana regenerates only that crop from a prompt, and PhotoCraft composites the result back through a feathered mask so pixels outside the crop are unchanged.

## ADDED Requirements

### Requirement: Invocation and input validation
`pi-photocraft replace-region <input> --prompt <text> --out <file>` SHALL accept exactly one region selector — `--rect x,y,w,h`, or `--select subject`, `--select sky`, or `--select object:x,y,w,h` — plus optional `--mask crop|selection` (default `crop`), `--pad <px>` (default 32), `--feather <px>` (default 8), `--min-crop <px>` (default 256), `--layered <file.psd>`, `--keep-temp`, and the nano-banana options `--model`, `--flash` and `--backend gemini|pi`. The following SHALL be usage errors (exit code `1`, detected before provisioning or generation): missing input, prompt, output or selector; more than one selector; a rect whose `x`/`y` are not integers (negative values are allowed and clip) or whose width/height are not positive integers; negative `--pad` or `--feather`; `--min-crop` < 1; `--pad` smaller than 3 × `--feather`; `--out` or `--layered` resolving to the same file as `<input>`.

#### Scenario: Two selectors
- **WHEN** both `--rect 0,0,10,10` and `--select subject` are given
- **THEN** a usage error is printed and the exit code is `1` before any provisioning or generation

#### Scenario: Pad too small for the feather
- **WHEN** `--pad 16 --feather 8` is given
- **THEN** a usage error states that `--pad` must be at least 3 × `--feather` (24) and the exit code is `1`

#### Scenario: Output would overwrite the input
- **WHEN** `--out` resolves to the same path as `<input>`
- **THEN** a usage error is printed, the exit code is `1`, and the input is unchanged

#### Scenario: Rect outside the image
- **WHEN** `--rect` lies entirely outside the input's bounds
- **THEN** after the image size has been read (provisioning failure, exit `69`, takes precedence), the command fails with an error naming the rect and the image size, exit code `1`, and no generation call is made

### Requirement: Region resolution
For `--rect`, the region box SHALL be the given rectangle clipped to the image. For `--select …`, the region box SHALL be the bounds PhotoCraft reports for that selection. The region only locates the crop; the composite mask is defined by "Composite back with locality". A selector that reports nothing selected (not selected, zero coverage, or zero-area bounds) SHALL fail without calling the generator.

#### Scenario: Semantic selector
- **WHEN** `--select object:100,50,120,100` is used on an image where PhotoCraft's object selection reports bounds `[139,96,42,8]`
- **THEN** the region box is `x=139,y=96,w=42,h=8`, not the hint rectangle

#### Scenario: Empty selection
- **WHEN** `--select sky` reports `selected: false` (no sky detected)
- **THEN** the command fails with an error stating nothing was selected, exit code `1`, and no generation call is made

### Requirement: Padded crop sent to the generator
The crop SHALL be computed in this order: the region box expanded by `--pad` on every side; then grown symmetrically to at least `--min-crop` on each axis; then clipped to the image. Only that clipped crop SHALL be sent to the generator; it equals the full image only when the image is no larger than the grown box.

#### Scenario: Padding
- **WHEN** the region box is `x=100,y=50,w=120,h=100` on a 320×200 image with `--pad 24 --feather 8 --min-crop 1`
- **THEN** the crop is `x=76,y=26,w=168,h=148`

#### Scenario: Tiny region grows to the minimum crop
- **WHEN** the region box is 42×8 on a 2000×2000 image with defaults
- **THEN** the crop sent to the generator is at least 256×256 and contains the region box padded by 32

#### Scenario: Clipping at the image edge
- **WHEN** the padded crop would extend past the image's top-left corner
- **THEN** the crop is clipped to the image and still contains the region box

#### Scenario: Image smaller than the minimum crop
- **WHEN** the image is 200×150 and `--min-crop` is 256
- **THEN** the crop is the whole image

### Requirement: Composite back with locality
The generated image SHALL be resized to exactly the crop's size regardless of the size the generator returned, placed at the crop's position, masked, and written to `--out` flattened. With `--mask crop` (default) the mask SHALL be the crop box inset by `--pad − --feather` on every side that was not clipped by the image edge (inset 0 on clipped sides), feathered by `--feather`, so a replacement object of a different shape or size than the original is shown whole and nothing of the original object survives inside the inset box. With `--mask selection` the mask SHALL be the region's own selection (the rect for `--rect`) feathered by `--feather` — for in-place edits that keep the object's outline. For a lossless input and lossless `--out`, every pixel outside the crop box SHALL be identical to the input in both modes.

#### Scenario: Generator returns a different resolution
- **WHEN** the crop is `x=84,y=34,w=152,h=132` and the generator returns a 304×264 image
- **THEN** the placed patch occupies exactly `x=84..236, y=34..166`

#### Scenario: Default crop mask shows a differently shaped replacement whole
- **WHEN** `--select object:…` locates a 182×182 object, the crop is `x=517,y=537,w=256,h=256` (defaults on a 1024×1024 image) and the generator draws a larger replacement object centred in the crop
- **THEN** the mask is the rect `x=541,y=561,w=208,h=208` feathered by 8, and every pixel of the generated patch inside that rect appears unchanged in `--out`

#### Scenario: Selection mask opt-in follows the object outline
- **WHEN** `--mask selection` is given with `--select object:…`
- **THEN** pixels outside the selection's feathered outline but inside the crop are identical to the input

#### Scenario: Pixels outside the crop are untouched
- **WHEN** `replace-region` completes on a PNG input with a PNG `--out`
- **THEN** every pixel outside the crop box is identical to the input

#### Scenario: Layered output
- **WHEN** `--layered out.psd` is given
- **THEN** a PSD is also written whose layers are the original image and the generated patch carrying a layer mask, and flattening it yields exactly the `--out` image

### Requirement: Failure semantics and reporting
`replace-region` SHALL never modify `<input>`. It SHALL write intermediates to a fresh directory under the OS temp directory, removed on exit unless `--keep-temp` is given. `--out` (and `--layered`) SHALL be written only after every step succeeded, each by an atomic move from a staged file; on any failure the invocation SHALL leave no output it created, and SHALL leave any pre-existing file at `--out`/`--layered` unchanged. Generator and PhotoCraft step failures SHALL exit `1` naming the failing step; provisioning failures SHALL exit `69`. On success it SHALL print one JSON object with `region`, `crop`, `backend`, `model` (null when the generator reports none), `out`, `layered` (null when not requested) and `timings` (milliseconds per step).

#### Scenario: Generator failure
- **WHEN** nano-banana returns `ok: false` (e.g. missing Gemini key)
- **THEN** the exit code is `1`, the error names the generate step, no `--out` file was created (a pre-existing one is unchanged), and the input file is unchanged

#### Scenario: Late PhotoCraft failure leaves no partial output
- **WHEN** the composite step fails after generation succeeded and `--layered` was requested
- **THEN** neither `--out` nor `--layered` was created by this invocation

#### Scenario: Success report
- **WHEN** `replace-region` succeeds
- **THEN** stdout holds exactly one JSON object with keys `region`, `crop`, `backend`, `model`, `out`, `layered` and `timings`
