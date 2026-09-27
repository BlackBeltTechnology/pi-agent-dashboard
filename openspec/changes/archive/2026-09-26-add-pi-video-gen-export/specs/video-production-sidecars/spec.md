## Purpose

Define and validate the machine-readable JSON sidecars a video-production shot package carries next to its markdown — film-level prompt directives, per-shot structured prompt fields, and the post-production timeline — so exporters and the mux step can consume a shot book without re-parsing prose.

## ADDED Requirements

### Requirement: Sidecar mode detection

The system SHALL treat a shot package as sidecar-enabled if and only if `film.json` exists in the package base dir. Packages without `film.json` SHALL behave exactly as before this change.

#### Scenario: Package without film.json

- **WHEN** a package has `shots/*.md` but no `film.json`
- **THEN** sidecar loading reports the package as not sidecar-enabled
- **AND** no sidecar problems are reported

#### Scenario: Package with film.json

- **WHEN** a package base dir contains `film.json`
- **THEN** the package is sidecar-enabled and film, shot and timeline sidecars are loaded and validated

### Requirement: Film sidecar schema

`film.json` SHALL be a JSON object with a required non-empty string `style`, optional non-empty strings `title`, `consistency`, `negative`, `aspectRatio`, and an optional `characters` array of `{ id, description }` objects with non-empty string fields and unique ids.

#### Scenario: Valid film sidecar

- **WHEN** `film.json` contains `style`, `aspectRatio: "16:9"` and two characters with distinct ids
- **THEN** it loads without problems

#### Scenario: Missing style

- **WHEN** `film.json` has no `style` or an empty `style`
- **THEN** a problem `film.json: style is required` is reported

#### Scenario: Duplicate character id

- **WHEN** two `characters` entries share an id
- **THEN** a problem naming the duplicated id is reported

#### Scenario: Malformed JSON

- **WHEN** `film.json` is not parseable JSON
- **THEN** a problem `film.json: invalid JSON` is reported and no shot or timeline sidecar validation depending on it proceeds

### Requirement: Shot sidecar schema

For each `shots/shot_<id>.md`, a sidecar-enabled package SHALL carry `shots/shot_<id>.json` with a `prompt` object (required non-empty strings `visuals` and `action`; optional non-empty strings `scene`, `effects`, `audio`; optional `visibleCharacters` string array) and a required number `durationSec` from 1 to 300. First-frame, seamless-continuity, seed and negative data SHALL continue to come from the shot markdown, not the sidecar.

#### Scenario: Valid shot sidecar

- **WHEN** `shots/shot_01.json` has `prompt.visuals`, `prompt.action` and `durationSec: 8`
- **THEN** it loads and is associated with the `shot_01` markdown shot

#### Scenario: Missing shot sidecar

- **WHEN** a sidecar-enabled package has `shots/shot_02.md` but no `shots/shot_02.json`
- **THEN** a problem `shot_02: sidecar missing` is reported

#### Scenario: Orphan shot sidecar

- **WHEN** `shots/shot_09.json` exists without a matching `shots/shot_09.md`
- **THEN** a problem `shot_09: sidecar has no matching shot markdown` is reported

#### Scenario: Missing required prompt field

- **WHEN** a shot sidecar lacks `prompt.visuals` or `prompt.action`, or either is empty
- **THEN** a problem naming the shot and the missing field is reported

#### Scenario: Unknown visible character

- **WHEN** `prompt.visibleCharacters` names an id absent from `film.json` `characters`
- **THEN** a problem naming the shot and the unknown id is reported

#### Scenario: Invalid duration

- **WHEN** `durationSec` is missing, non-numeric, less than 1, or greater than 300
- **THEN** a problem naming the shot is reported

### Requirement: Timeline sidecar schema

A sidecar-enabled package MAY carry `timeline.json`. When present it SHALL be an object with a non-empty `segments` array and optional `output` with only the keys `resolution` (`<W>x<H>`, each component 3–4 digits, even, at most 4096), `fps` (integer 1–120) and `codec` (`mpeg4` or `h264`), `voiceover` (`path`, optional `volume` 0–2 default 1, optional `offsetSec` ≥ 0 default 0), `music` (`path`, optional `volume` 0–2 default 0.3), `captions` (`path` to an `.srt` file whose cue times are in the final output's time base, i.e. not shifted by `voiceover.offsetSec`). Each segment SHALL have exactly one of `shot` (a shot id present in the package) or `image` (a png/jpg/jpeg/webp path), plus optional `trimStartSec` (≥ 0 and less than the shot's sidecar `durationSec`, shot segments only), `durationSec` (0.5–300; required for image segments), `ambientVolume` (0–2, shot segments only), `transitionTo` (`{ style, durationSec }` with `style` one of `fade`, `fadeblack`, `fadewhite`, `wipeleft`, `wiperight`, `slideup`, `slidedown`, `circlecrop`, `dissolve` and `durationSec` in (0, 3] and shorter than the segment's effective duration; not allowed on the last segment), and `overlay` (`{ title?, subtitle?, position? }` with `position` one of `bottom-left`, `bottom-center`, `top-left`, `center`). A shot segment's effective duration is its `durationSec`, else the shot sidecar `durationSec` minus `trimStartSec`; it SHALL lie in 0.5–300, and `trimStartSec` plus the effective duration SHALL NOT exceed the shot sidecar `durationSec`. These bounds match the timeline validator of pi-video-gen 0.1.18.

#### Scenario: Valid timeline

- **WHEN** `timeline.json` lists three shot segments and one image end-card segment with `durationSec`
- **THEN** it loads without problems

#### Scenario: Segment with both shot and image

- **WHEN** a segment sets both `shot` and `image`, or neither
- **THEN** a problem naming the segment index is reported

#### Scenario: Unknown shot reference

- **WHEN** a segment's `shot` is not a shot id in the package
- **THEN** a problem naming the segment index and the id is reported

#### Scenario: Image segment without duration

- **WHEN** an image segment has no `durationSec`
- **THEN** a problem naming the segment index is reported

#### Scenario: Unsupported transition style

- **WHEN** a segment has `transitionTo.style: "crossfade"`
- **THEN** a problem naming the segment index and listing the allowed styles is reported

#### Scenario: Transition longer than its segment

- **WHEN** a segment's `transitionTo.durationSec` is not shorter than its effective duration, or exceeds 3
- **THEN** a problem naming the segment index is reported

#### Scenario: Transition on the last segment

- **WHEN** the last segment has a `transitionTo`
- **THEN** a problem naming the segment index is reported

#### Scenario: Unsupported overlay position

- **WHEN** a segment has `overlay.position: "top-right"`
- **THEN** a problem naming the segment index and listing the allowed positions is reported

#### Scenario: Invalid output settings

- **WHEN** `output.fps` is `29.97`, `output.resolution` is `1921x1080` or `64x64`, `output.codec` is `vp9`, or `output` has any other key
- **THEN** a problem naming the field is reported

#### Scenario: Trim consumes the clip

- **WHEN** a shot segment's `trimStartSec` is not less than the shot's sidecar `durationSec`, its effective duration is below 0.5, or `trimStartSec` plus its `durationSec` exceeds the shot's sidecar `durationSec` (e.g. `durationSec: 12` on an 8 s shot)
- **THEN** a problem naming the segment index is reported

### Requirement: Sidecar path containment

Every file path inside a sidecar (timeline `image`, `voiceover.path`, `music.path`, `captions.path`) SHALL be interpreted relative to the package base dir and SHALL resolve to an existing regular file inside the package base dir that is not itself a symlink and whose real path (after resolving symlinked parent dirs) is inside the package base dir. Absolute paths and paths escaping the base dir SHALL be rejected.

#### Scenario: Relative path inside the package

- **WHEN** `voiceover.path` is `audio/vo.wav` and that file exists under the base dir
- **THEN** it resolves to the absolute file path without a problem

#### Scenario: Path escaping the package

- **WHEN** a sidecar path is `../../etc/passwd` or an absolute path
- **THEN** a problem `path escapes package` naming the field is reported

#### Scenario: Symlink pointing outside

- **WHEN** a sidecar path's parent dir is a symlink whose target lies outside the base dir
- **THEN** a problem `path escapes package` naming the field is reported

#### Scenario: File is a symlink

- **WHEN** a sidecar path is itself a symlink, even to a file inside the base dir
- **THEN** a problem `path is a symlink` naming the field is reported

#### Scenario: Missing file

- **WHEN** a sidecar path does not exist
- **THEN** a problem `file not found` naming the field is reported

### Requirement: Problem scopes

Every sidecar problem SHALL carry one scope: `film` (film.json), `shot` (shot sidecars), `timeline` (timeline structure and image segment files), or `audio` (`voiceover`, `music`, `captions` fields and files). Consumers SHALL fail only on the scopes they consume.

#### Scenario: Missing voiceover file

- **WHEN** `timeline.json` declares `voiceover.path` that does not exist
- **THEN** the problem has scope `audio`

#### Scenario: Unknown shot in timeline

- **WHEN** a timeline segment references an unknown shot
- **THEN** the problem has scope `timeline`
