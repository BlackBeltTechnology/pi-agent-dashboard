## Purpose

Generate job specs for the external `@amaster.ai/pi-video-gen` pi extension (verified against 0.1.18) from a sidecar-enabled shot package — a multi-shot `render-input.json` for its `video_render` tool and a picture-edit `timeline-input.json` for its `video_compose` tool — with local preflight, since that extension offers no dry-run and consumes a fresh job directory on its first call.

## ADDED Requirements

### Requirement: Export requires a valid sidecar-enabled package

Both export modes SHALL refuse to write anything when the package is not sidecar-enabled, or when it has a sidecar problem in a scope the mode consumes — `export render`: `film`, `shot`; `export timeline`: `film`, `shot`, `timeline` — and SHALL report those problems. Problems in other scopes SHALL be reported as warnings. `export timeline` SHALL additionally require `timeline.json`. The package base dir SHALL lie inside the export cwd.

#### Scenario: Package without sidecars

- **WHEN** `export render` targets a package with no `film.json`
- **THEN** it reports `package has no film.json — sidecars required for export`, writes no file, and fails

#### Scenario: Package with sidecar problems

- **WHEN** a sidecar-enabled package has a `shot` scope problem
- **THEN** both export modes report it, write no file, and fail

#### Scenario: Audio problem does not block export

- **WHEN** the only sidecar problem is a missing voiceover file (scope `audio`)
- **THEN** `export render` and `export timeline` succeed and list the problem as a warning

#### Scenario: Package outside cwd

- **WHEN** the target package base dir is not inside the export cwd
- **THEN** export fails with `package must be inside the working directory (the pi session cwd)` and writes nothing

#### Scenario: Timeline export without timeline.json

- **WHEN** `export timeline` targets a sidecar-enabled package with no `timeline.json`
- **THEN** it reports `timeline.json required for export timeline`, writes no file, and fails

### Requirement: Job directory and job id

Each export SHALL write into a new job directory `<outDir>/<jobId>/`. `outDir` SHALL default to `<cwd>/.video-gen` and be overridable with `--out <dir>`. The package name SHALL be the basename of the project dir when the package base dir is named `video_production`, else the basename of the package base dir; for job ids it SHALL be sanitized by replacing every character outside `[A-Za-z0-9_-]` with `-`, stripping leading characters outside `[A-Za-z0-9]`, falling back to `package` when empty, and truncating so the whole id is at most 64 characters. The default `jobId` SHALL be `<sanitized-name>-<mode>-<YYYYMMDD-HHMMSS>` (UTC). Every job id, default or supplied via `--job`, SHALL match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Export SHALL NOT write into an existing job directory.

#### Scenario: Default job id

- **WHEN** `export render` runs without `--job` for project dir `booth-2026`
- **THEN** it creates `<cwd>/.video-gen/booth-2026-render-<timestamp>/render-input.json`

#### Scenario: Package name needing sanitization

- **WHEN** the project dir is named `.Trade show v1.2`
- **THEN** the default job id starts with `Trade-show-v1-2-render-` and matches the job id pattern

#### Scenario: Long package name

- **WHEN** the project dir name is 80 characters long
- **THEN** the default job id is at most 64 characters and still ends with `-render-<timestamp>`

#### Scenario: Existing job directory

- **WHEN** the resolved job directory already exists
- **THEN** export fails with `job directory exists — exports never reuse a job` and writes nothing

#### Scenario: Unsafe job id

- **WHEN** `--job` is `-abc`, contains a character outside `[A-Za-z0-9_-]`, or is longer than 64 characters
- **THEN** export fails before creating any directory

#### Scenario: Custom output dir

- **WHEN** `--out /work/vg` is passed
- **THEN** the job directory is created under `/work/vg`

### Requirement: No accidental re-render jobs

Every successful `export render` SHALL record the absolute path of the written spec in the package-local registry `<package base>/.pi-veo/exports.json`. When that registry exists but cannot be read or parsed as the expected shape, `export render` SHALL fail with a message naming the file (never treat it as empty). `export render` SHALL fail when that registry lists a render spec that still exists — regardless of its job id or output dir — unless `--new-job` is passed. The failure SHALL list the existing spec paths and state that an interrupted render resumes by calling `video_render` again on the existing spec. Registry entries whose spec no longer exists SHALL be ignored.

#### Scenario: Prior render job exists

- **WHEN** the registry lists `.video-gen/booth-2026-render-20260924-101500/render-input.json`, that file exists, and `export render` runs without `--new-job`
- **THEN** export fails, lists that spec path, tells the user to re-call `video_render` on it to resume, and writes nothing

#### Scenario: Prior job under a custom id and output dir

- **WHEN** a previous export used `--job take1 --out /work/vg` and its spec still exists
- **THEN** a later `export render` without `--new-job` fails and lists `/work/vg/take1/render-input.json`

#### Scenario: Corrupt registry fails closed

- **WHEN** `.pi-veo/exports.json` contains invalid JSON
- **THEN** `export render` fails naming the registry file and writes nothing, even with `--new-job`

#### Scenario: Deliberate new job

- **WHEN** a prior render job exists and `--new-job` is passed
- **THEN** export writes a new job directory

### Requirement: Render spec mapping

`export render` SHALL write `render-input.json` containing: `title`, `aspectRatio`, `style`, `consistency`, `negative` and `characters` copied from `film.json` (omitting absent optional fields); and one shot per markdown shot in package order with `id` = shot name, `prompt` copied field-for-field from the shot sidecar, `durationSec` from the sidecar (rounded per the duration rule), and `firstFramePath` = the shot's first-frame image. It SHALL NOT pre-join prompt text. Every shot name SHALL match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.

#### Scenario: Structured prompt copied verbatim

- **WHEN** a shot sidecar has `visuals`, `action`, `scene`, `audio` and `visibleCharacters`
- **THEN** the emitted shot's `prompt` object has exactly those keys and values

#### Scenario: Shot without first frame

- **WHEN** a shot's markdown resolves no first-frame image
- **THEN** export fails naming the shot (`first frame required`) and writes nothing

#### Scenario: Unsafe shot name

- **WHEN** a shot file is named `shot_01.2.md` or `shot_01 final.md`
- **THEN** export fails naming the shot (`shot id not accepted by pi-video-gen`) and writes nothing

#### Scenario: Film fields copied

- **WHEN** `film.json` has `style`, `negative` and two characters
- **THEN** `render-input.json` carries the same `style`, `negative` and `characters` at film level and does not repeat them per shot

### Requirement: Seamless continuity as last-frame interpolation

For a shot flagged seamless-to-next, `export render` SHALL set `lastFramePath` to the first-frame image of the next shot in package order, unless `--no-last-frame` is set, in which case it SHALL omit `lastFramePath` and report a warning listing the affected shots.

#### Scenario: Seamless pair

- **WHEN** cwd is the project dir, `shot_02A` is seamless-to-next and `shot_02B` has first frame `video_production/storyboard/shot_02B.png`
- **THEN** `shot_02A` is emitted with `lastFramePath: "video_production/storyboard/shot_02B.png"`

#### Scenario: Seamless last shot

- **WHEN** the final shot in package order is flagged seamless-to-next
- **THEN** no `lastFramePath` is emitted for it and a warning names the shot

#### Scenario: Last frame disabled

- **WHEN** `--no-last-frame` is passed
- **THEN** no shot carries `lastFramePath` and a warning lists every seamless shot

### Requirement: Frame preflight

Every emitted frame path SHALL be written relative to the export cwd and SHALL be a regular, non-symlink file inside the cwd (after resolving symlinked parent dirs), at most 20 MiB, whose content begins with a PNG, JPEG or WebP signature.

#### Scenario: Frame inside cwd

- **WHEN** the cwd is the project dir and the frame is `video_production/storyboard/shot_01.png`
- **THEN** `firstFramePath` is `video_production/storyboard/shot_01.png`

#### Scenario: Frame outside cwd

- **WHEN** a frame resolves outside the cwd
- **THEN** export fails naming the shot (`frame outside working directory`)

#### Scenario: Frame is a symlink

- **WHEN** a frame path is a symlink
- **THEN** export fails naming the shot (`frame is a symlink`)

#### Scenario: Frame content is not an image

- **WHEN** `shot_01.png` contains text rather than PNG/JPEG/WebP bytes, or exceeds 20 MiB
- **THEN** export fails naming the shot and the reason

### Requirement: Duration rule and capability preflight

`export render` SHALL round each non-integer `durationSec` to the nearest integer (halves up) and warn per changed shot. When `--durations <min>-<max>` is given it SHALL fail listing every shot whose rounded duration is outside the range. When `--aspect <list>` (comma-separated) is given it SHALL fail if the film aspect ratio is set and not in the list.

#### Scenario: Fractional duration

- **WHEN** a sidecar has `durationSec: 7.5`
- **THEN** the emitted shot has `durationSec: 8` and a warning names the shot

#### Scenario: Duration outside capability range

- **WHEN** `--durations 5-8` is passed and a shot rounds to 4
- **THEN** export fails listing that shot and writes nothing

#### Scenario: Unsupported aspect ratio

- **WHEN** `--aspect 16:9` is passed and `film.json` has `aspectRatio: "9:16"`
- **THEN** export fails naming the aspect ratio

#### Scenario: No capability flags

- **WHEN** neither `--durations` nor `--aspect` is passed
- **THEN** no range or aspect check is applied beyond integer rounding

### Requirement: Dropped-field warnings

`export render` SHALL always report that per-shot resolution is not exported (the active pi-video-gen model's default applies), and SHALL warn when any shot markdown carries a seed, reference images, a negative prompt different from `film.json` `negative`, or an aspect ratio different from `film.json` `aspectRatio`, none of which are exported per shot.

#### Scenario: Resolution note

- **WHEN** `export render` succeeds
- **THEN** the warnings include the resolution note

#### Scenario: Seed present

- **WHEN** any shot markdown has a seed
- **THEN** a warning states that seeds are not exported

#### Scenario: Per-shot negative differs

- **WHEN** `shot_03.md` has a negative prompt that differs from `film.json` `negative`
- **THEN** a warning names `shot_03` and states per-shot negatives are not exported

#### Scenario: Per-shot aspect differs

- **WHEN** `film.json` has `aspectRatio: "16:9"` and `shot_04.md` declares `9:16`
- **THEN** a warning names `shot_04` and states per-shot aspect ratios are not exported

#### Scenario: Reference images present

- **WHEN** any shot markdown lists reference images
- **THEN** a warning states that local reference images are not exported

### Requirement: Timeline spec mapping (picture edit only)

`export timeline --clips <dir>` SHALL write `timeline-input.json` from `timeline.json`: `output` copied when present; one segment per timeline segment in order, with `id` = `seg-` followed by the 1-based segment index zero-padded to two digits; shot segments become `video` segments whose clip is `<dir>/<shot>.mp4`, else `<dir>/<shot>/video.mp4`, with `trimStartSec`, `durationSec` (the segment's effective duration), `sourceAudio.volume` from `ambientVolume` (default 1), `transitionTo` (as `{ type: "xfade", style, durationSec }`) and `overlay`; image segments become `image` segments with `durationSec`, `transitionTo` and `overlay`. The spec SHALL NOT contain `voice`, `narration`, `bgm` or `subtitles`.

#### Scenario: Segment ids

- **WHEN** the timeline has 12 segments, two of them referencing the same shot
- **THEN** the emitted ids are `seg-01` … `seg-12`, all unique

#### Scenario: Clip resolution in renders layout

- **WHEN** `--clips video_production/renders` contains `shot_01.mp4`
- **THEN** the segment for `shot_01` uses that file

#### Scenario: Clip resolution in pi-video-gen job layout

- **WHEN** `--clips .video-gen/job/shots` contains `shot_01/video.mp4`
- **THEN** the segment for `shot_01` uses that file

#### Scenario: Missing clip

- **WHEN** neither clip layout has a file for a referenced shot
- **THEN** export fails listing the missing shots and writes nothing

#### Scenario: No audio directives emitted

- **WHEN** `timeline.json` defines `voiceover`, `music` and `captions`
- **THEN** `timeline-input.json` contains no `voice`, `narration`, `bgm` or `subtitles` keys

### Requirement: Timeline media preflight

Every emitted `video` and `image` path SHALL be absolute and SHALL resolve to a regular, non-symlink file inside the export cwd (after resolving symlinked parent dirs).

#### Scenario: Clips outside cwd

- **WHEN** `--clips /elsewhere/renders` lies outside the cwd
- **THEN** export fails naming the affected segments (`media outside working directory`) and writes nothing

#### Scenario: Symlinked clip

- **WHEN** a resolved clip file is a symlink
- **THEN** export fails naming the segment (`media is a symlink`)

### Requirement: Export report

Export SHALL print the written spec path, the pi-video-gen tool to call next (`video_render` or `video_compose`), the working directory used (which must be the pi session cwd), a note that the job dir must lie under pi-video-gen's `outputDir` (default `.video-gen`; pass `--out` if it was configured differently), and all warnings; with `--json` it SHALL print `{ specPath, jobDir, tool, warnings }` instead.

#### Scenario: Human report

- **WHEN** `export render` succeeds with one warning
- **THEN** stdout names the spec path, instructs to call `video_render` with it, and lists the warning

#### Scenario: JSON report

- **WHEN** `export timeline --json` succeeds
- **THEN** stdout is a JSON object with `specPath`, `jobDir`, `tool: "video_compose"` and `warnings`
