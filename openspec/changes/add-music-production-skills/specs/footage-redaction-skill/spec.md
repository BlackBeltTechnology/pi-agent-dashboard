## Purpose

The `footage-redaction` pi skill bakes redaction into screen-recording footage from a declarative JSON spec: fixed crops, time-windowed logo removal, and blurs switched on only while a detected UI element is visible. A mandatory visual verification step follows.

## ADDED Requirements

### Requirement: Declarative redaction spec
The skill SHALL provide a redaction script invoked as `<in> <out> --spec <json>`. The spec SHALL accept:
- `trim {from, to}` in seconds, `speed` (> 0) and `fps`, for cutting a clip in the same pass;
- `crop {top, bottom, left, right}` in pixels;
- `delogo[] {x, y, w, h, from, to}` with times in seconds;
- `blur_when[] {x, y, w, h, detect {x, y, w, h, rgb[3], tol, min_ratio}, pad_s}`.

All box coordinates (`delogo`, `blur_when` target and detect boxes) SHALL be in source-frame pixels, before crop and scale, on the untrimmed source timeline; the script shifts every time window by `trim.from`. The filter order SHALL be: trim → delogo → blur → crop → speed → fps → encode. The script SHALL depend only on the Python standard library and ffmpeg/ffprobe, so it needs no venv.

Every numeric field SHALL be finite and non-negative. In addition:
- `rgb` SHALL be three integers from 0 to 255;
- `min_ratio` SHALL be in (0, 1];
- `tol` SHALL be in [0, 255];
- every `from` SHALL be less than its `to`;
- every box SHALL lie inside the source frame. A spec violating this SHALL be rejected with a non-zero exit that names the field, and no output SHALL be written.

#### Scenario: Ratio out of range rejected
- **WHEN** a `blur_when` entry has `min_ratio` 1.5
- **THEN** the script exits non-zero naming `blur_when[0].detect.min_ratio`

#### Scenario: Out-of-frame box rejected
- **WHEN** a `delogo` box extends past the frame width
- **THEN** the script exits non-zero naming `delogo[0]` and writes no output

#### Scenario: Boxes are source-frame coordinates
- **WHEN** a spec crops the top 100 px and delogos a box at y = 50
- **THEN** the delogo is applied before the crop, the box region is removed, and validation measures the box against the uncropped frame

#### Scenario: Crop applied
- **WHEN** a 1920×1080 input is processed with `crop {top: 100, bottom: 80}`
- **THEN** the output is 1920×900

### Requirement: Conditional blur follows a detected UI element
For each `blur_when` entry, the script SHALL sample the detect box every 0.25 s. The detect box is active when the ratio of pixels within `tol` of `rgb` is at least `min_ratio`. Active samples SHALL be merged into intervals padded by `pad_s`, and the blur SHALL be enabled only within those intervals.

#### Scenario: Popup-timed blur
- **WHEN** a synthetic video shows a navy box in the detect region only between 2 s and 4 s, and `pad_s` is 0.25
- **THEN** the resolved blur window is within [1.75 s, 4.25 s] ± 0.25 s
- **AND** frames at 1.0 s and 5.0 s are unblurred in the target box

### Requirement: Redaction never fails silently
When a `blur_when` entry resolves to no active window, the script SHALL print a warning naming the entry. With `--strict`, it SHALL exit non-zero instead. The output SHALL be written to a temporary path and renamed on success; on failure, no file SHALL remain at the output path.

#### Scenario: Never-active detector
- **WHEN** a detect colour never appears in the video and `--strict` is set
- **THEN** the script exits non-zero naming the entry and no output file exists

#### Scenario: ffmpeg failure leaves no partial output
- **WHEN** ffmpeg fails mid-encode
- **THEN** no file exists at the output path

### Requirement: Safe process invocation and dry run
The script SHALL invoke ffmpeg with an argument vector, never through a shell. `--dry-run` SHALL print the resolved blur windows and the complete filter graph without writing output.

#### Scenario: Dry run
- **WHEN** the script runs with `--dry-run`
- **THEN** it prints the windows and the filter graph and creates no output file

#### Scenario: Shell metacharacters in path
- **WHEN** the input path contains `;` and `$(`
- **THEN** the file is processed as a literal path and no extra command executes

### Requirement: Visual verification is mandatory
The skill SHALL require a contact-sheet check of every redacted clip at the known sensitive timecodes before the clip is used. It SHALL state that OCR is insufficient for transient text such as flashing browser status-bar URLs.

#### Scenario: Verification step present
- **WHEN** the skill markdown is read
- **THEN** it contains the contact-sheet command and the OCR-insufficiency warning
