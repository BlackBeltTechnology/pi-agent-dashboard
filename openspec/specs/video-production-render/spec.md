# video-production-render Specification

## Purpose

Render a shot package into mp4 clips via an injectable Google Veo 3.1 client. For each shot the renderer builds a `generateVideos` config, submits it, polls the long-running operation, and downloads the resulting video to `<outDir>/<shot>.mp4`. Rendering is idempotent (existing outputs skipped unless forced), supports sequential `--chain` continuity (last frame of one clip seeds the next) and bounded-parallel modes, and appends one JSONL record per finished shot to a render log.

## Requirements

### Requirement: Build the generateVideos request per shot

The system SHALL build a Veo `generateVideos` config and optional first-frame image from a shot and render flags before submitting.

#### Scenario: Base config fields
- **WHEN** a request is built for a shot
- **THEN** the config SHALL set `numberOfVideos` to 1, `aspectRatio` to the shot's aspect ratio, and `resolution` to the flag resolution if provided, otherwise the shot's resolution

#### Scenario: Optional config fields
- **WHEN** the shot has a negative prompt
- **THEN** the config SHALL include `negativePrompt`
- **AND** when the shot has a non-null seed and `noSeed` is not set, the config SHALL include `seed`
- **AND** when `enhancePrompt` flag is set, the config SHALL include `enhancePrompt` from the shot

#### Scenario: First-frame image selection
- **WHEN** a first-frame override is provided, or `noFirstFrame` is not set and the shot has a first-frame sketch
- **AND** that image path exists on disk
- **THEN** the request SHALL include the image loaded as a base64 `VeoImage` with a mime type derived from the file extension (defaulting to `image/png`)

#### Scenario: Reference images
- **WHEN** `withReference` is set and the shot has reference images
- **THEN** the config SHALL include up to the first 3 reference images that exist on disk, each with `referenceType` `asset`
- **AND** if none of them exist on disk, the config SHALL omit `referenceImages`

### Requirement: Resolve the render plan without calling the API

The system SHALL resolve output directory, model, API key state, and shot list independently of any network call.

#### Scenario: Output directory
- **WHEN** an explicit `out` path is provided
- **THEN** the plan output directory SHALL be that resolved path
- **AND** otherwise it SHALL be the `renders` subdirectory of the package base directory

#### Scenario: Model alias resolution
- **WHEN** a model name or alias (`standard`, `fast`, `veo3.1`, `veo-3.1`) is provided
- **THEN** the plan model SHALL be the aliased Veo model id
- **AND** when no model is provided the plan SHALL default to `veo-3.1-generate-preview`

#### Scenario: Missing prompt detection
- **WHEN** the plan is resolved
- **THEN** the plan SHALL list the names of all shots that have no Full Veo prompt

### Requirement: Submit with poll loop and reference-image retry

The system SHALL submit the request, poll until the operation is done, and retry once without reference images when the initial submit throws.

#### Scenario: Poll until done
- **WHEN** a submit succeeds and the returned operation is not done
- **THEN** the system SHALL sleep the poll interval (default 12 seconds) and poll again, repeating until the operation reports done

#### Scenario: Retry without reference images
- **WHEN** the initial submit throws and the config contained `referenceImages`
- **THEN** the system SHALL log a retry notice and resubmit with the same config minus `referenceImages`

#### Scenario: Retry exhausted / no reference images
- **WHEN** the initial submit throws and the config did not contain `referenceImages`
- **THEN** the error SHALL propagate and the shot SHALL be recorded as an error

### Requirement: Idempotent skip of existing outputs

The system SHALL skip a shot whose output mp4 already exists unless forced.

#### Scenario: Existing output skipped
- **WHEN** the destination `<outDir>/<shot>.mp4` exists and `force` is not set
- **THEN** the system SHALL log a skip notice, return status `skip`, and SHALL NOT submit to the API or append a log record

#### Scenario: Force re-render
- **WHEN** `force` is set
- **THEN** the system SHALL render the shot even if its output already exists

### Requirement: Download the generated video and record outcome

The system SHALL download the first generated video to the destination and classify each shot as ok or error.

#### Scenario: Successful render
- **WHEN** the operation completes without error and the response contains a generated video
- **THEN** the system SHALL download it to `<outDir>/<shot>.mp4`, log success with elapsed seconds, and return status `ok`

#### Scenario: Operation error
- **WHEN** the completed operation carries an `error` field
- **THEN** the system SHALL log the error, append an error log record, and return status `error` without downloading

#### Scenario: Missing or unsaveable video
- **WHEN** the response has no generated video, or the download fails
- **THEN** the system SHALL log the failure, append an error log record, and return status `error`

### Requirement: JSONL render log

The system SHALL append one JSON line per attempted (non-skipped) shot to `render_log.jsonl` in the output directory.

#### Scenario: Log record contents
- **WHEN** a log record is appended
- **THEN** it SHALL include an ISO timestamp, shot name, model, seed, aspect ratio, and effective resolution
- **AND** on success it SHALL include `status` `ok`, the output path, and elapsed seconds
- **AND** on failure it SHALL include `status` `error` and the error message

### Requirement: Sequential chain mode for seamless continuity

The system SHALL render sequentially in `--chain` mode, seeding each seamless shot's first frame from the previous clip's last frame.

#### Scenario: Chain forces sequential
- **WHEN** `chain` is set together with a `parallel` value greater than 1
- **THEN** the system SHALL log a note and render sequentially (concurrency 1), ignoring `parallel`

#### Scenario: Last-frame carry-over
- **WHEN** rendering a shot in chain mode where the previous shot is flagged seamless-next and its rendered clip exists
- **THEN** the system SHALL extract the previous clip's last frame with ffmpeg and use it as this shot's first-frame override

#### Scenario: Extraction failure falls back to sketch
- **WHEN** ffmpeg last-frame extraction fails
- **THEN** the system SHALL log a warning and render the shot using its own first-frame sketch

### Requirement: Bounded parallel mode

The system SHALL render independent shots concurrently up to a bounded worker count when not chaining.

#### Scenario: Bounded concurrency
- **WHEN** `parallel` is greater than 1 and `chain` is not set
- **THEN** the system SHALL run at most `min(parallel, shotCount)` concurrent render workers, each pulling the next shot until all shots are processed

#### Scenario: Preconditions before rendering
- **WHEN** rendering starts
- **THEN** the system SHALL throw if no shots match, if any shot lacks a Full Veo prompt, or if no API key can be resolved
