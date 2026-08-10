# video-production-shot-package Specification

## Purpose

Resolve the on-disk layout of a video-production project and parse its `shot_*.md` files into structured `Shot` objects. Given a project dir, a `video_production` dir, or a `shots` dir, locate the shots directory plus the package base dir that image paths resolve against, then read each shot markdown file into fields covering prompt, negative prompt, seed, aspect ratio, resolution, reference images, first-frame sketch, and seamless-continuity metadata.

## Requirements

### Requirement: Package layout resolution

The system SHALL accept a project dir, a `video_production` dir, or a `shots` dir and return the directory containing `shot_*.md` files (`shotsDir`) plus the package base dir (`baseDir`) that image paths resolve against.

A path is treated as a shots dir when it is a directory that directly contains at least one file matching `shot_*.md`. A file matches when its name matches the regex `^shot_.*\.md$`.

#### Scenario: Leading tilde expansion

- **WHEN** the target path is `~` or begins with `~/`
- **THEN** the leading `~` is expanded to the user's home directory before resolution

#### Scenario: Nonexistent path

- **WHEN** the resolved target path does not exist on disk
- **THEN** an error is thrown with message `path does not exist: <path>`

#### Scenario: Target is a shots dir

- **WHEN** the target is a directory that directly contains one or more `shot_*.md` files
- **THEN** `shotsDir` is the target directory
- **AND** `baseDir` is the parent directory of the target

#### Scenario: Target is a video_production dir

- **WHEN** the target does not directly contain `shot_*.md` files but has a `shots` subdirectory containing one or more `shot_*.md` files
- **THEN** `shotsDir` is `<target>/shots`
- **AND** `baseDir` is the target directory

#### Scenario: Target is a project dir

- **WHEN** the target has a `video_production/shots` subdirectory containing one or more `shot_*.md` files
- **THEN** `shotsDir` is `<target>/video_production/shots`
- **AND** `baseDir` is `<target>/video_production`

#### Scenario: No shots found

- **WHEN** no `shot_*.md` file is found in the target dir, `<target>/shots`, or `<target>/video_production/shots`
- **THEN** an error is thrown reporting the searched locations (`., ./shots, ./video_production/shots`)

### Requirement: Shot loading and ordering

The system SHALL parse every `shot_*.md` file in the resolved shots dir into a `Shot`, in ascending filename order, and return the shots together with the package `baseDir`.

#### Scenario: All shots parsed in filename order

- **WHEN** shots are loaded without a name filter
- **THEN** every `shot_*.md` file in the shots dir is parsed into a `Shot`
- **AND** the shots are ordered by ascending filename

#### Scenario: Filtering by shot name

- **WHEN** a list of names is supplied
- **THEN** only shots whose short id (name with a leading `shot_` removed) or whose full `name` case-insensitively matches a requested name are returned
- **AND** each requested name is also matched after stripping a leading `shot_` prefix

### Requirement: Shot field parsing

The system SHALL parse a shot markdown file into a `Shot` with fields `name`, `path`, `title`, `prompt`, `negative`, `seed`, `aspectRatio`, `resolution`, `enhancePrompt`, `referenceImages`, `firstFrame`, `continuity`, and `seamlessNext`, applying documented defaults when a field is absent.

`name` is the file basename without extension (e.g. `shot_03A`). The short id strips a leading `shot_` (e.g. `03A`).

#### Scenario: Title from top-level heading

- **WHEN** the file contains a top-level `# ` heading
- **THEN** `title` is the trimmed heading text
- **AND** `title` is the empty string when no such heading exists

#### Scenario: Prompt and negative prompt from fenced blocks

- **WHEN** the file contains a heading with the text `Full Veo prompt` and/or `Negative prompt`
- **THEN** `prompt` is the trimmed contents of the first fenced ``` ``` ``` code block after the `Full Veo prompt` heading
- **AND** `negative` is the trimmed contents of the first fenced code block after the `Negative prompt` heading
- **AND** each field is the empty string when its heading is absent

#### Scenario: Seed parsing

- **WHEN** the text contains `Seed` followed by a number of three or more digits
- **THEN** `seed` is that integer
- **AND** `seed` is `null` when no such value is present

#### Scenario: Aspect ratio parsing

- **WHEN** the text contains `Aspect` followed by a value of the form `<digits>:<digits>`
- **THEN** `aspectRatio` is that value
- **AND** `aspectRatio` defaults to `16:9` when absent

#### Scenario: Resolution parsing

- **WHEN** the text contains a resolution token
- **THEN** `resolution` is `4k` if `4k` appears, otherwise `1080p` if `1080p` appears, otherwise `720p` if `720p` appears
- **AND** `resolution` defaults to `1080p` when no token is present

#### Scenario: Enhance-prompt flag

- **WHEN** the text contains `enhance_prompt` followed by `true` or `false`
- **THEN** `enhancePrompt` is the corresponding boolean
- **AND** `enhancePrompt` defaults to `false` when absent

### Requirement: Image reference resolution

The system SHALL resolve reference-image and first-frame paths, written as backtick-quoted `.png`/`.jpg`/`.jpeg`/`.webp` paths, against the package base dir, and drop references that do not exist on disk.

An image path is resolved by first trying `<baseDir>/<path>`, then `<baseDir>/storyboard/<basename>`; if neither exists as a file the reference resolves to `null` (missing on disk).

#### Scenario: Reference images collected

- **WHEN** a line contains the text `reference image` and one or more backtick-quoted image paths
- **THEN** each path is resolved against the base dir and added to `referenceImages`
- **AND** references that cannot be resolved on disk are omitted
- **AND** duplicate resolved paths are not added twice

#### Scenario: First-frame sketch

- **WHEN** a line contains `first-frame` or `first frame` and a backtick-quoted image path
- **THEN** `firstFrame` is the resolved absolute path of that image, or `null` if it cannot be resolved
- **AND** `firstFrame` is `null` when no first-frame line is present

### Requirement: Continuity and seamless-transition detection

The system SHALL extract continuity text and flag an outgoing seamless transition when a continuity line describes a seamless flow into the next shot.

#### Scenario: Continuity text

- **WHEN** a line contains the text `continuity`
- **THEN** `continuity` is the portion of the line after the first `:`, with surrounding whitespace and `*` characters trimmed

#### Scenario: Outgoing seamless transition

- **WHEN** a continuity line matches `seamless` followed by `to`, `→`, or `->`
- **THEN** `seamlessNext` is `true`
- **AND** `seamlessNext` defaults to `false` otherwise
