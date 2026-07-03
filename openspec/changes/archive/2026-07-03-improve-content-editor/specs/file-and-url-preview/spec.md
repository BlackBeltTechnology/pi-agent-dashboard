# file-and-url-preview — delta

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "fallback"`.

#### Scenario: Markdown extension
- **WHEN** `dispatchPreview({ kind: "file", cwd, path: "x.md" })` is called
- **THEN** the result is `"markdown"`

#### Scenario: PDF extension
- **WHEN** the file extension is `.pdf`
- **THEN** the result is `"pdf"`

#### Scenario: Video extensions
- **WHEN** the file extension is one of `.mp4`, `.webm`, `.mov`
- **THEN** the result is `"video"`

#### Scenario: Audio extensions
- **WHEN** the file extension is one of `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- **THEN** the result is `"audio"`

#### Scenario: Image extensions
- **WHEN** the file extension is one of `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`
- **THEN** the result is `"image"`

#### Scenario: HTML extension
- **WHEN** the file extension is `.html` or `.htm`
- **THEN** the result is `"html"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: Audio preview renderer

The dashboard SHALL provide an `AudioPreview` renderer for audio file targets. It SHALL
stream bytes from `/api/file/raw` into an `<audio controls preload="metadata">` element,
relying on the raw endpoint's HTTP Range support for seeking. It SHALL show a loading
state and an error state on fetch failure, mirroring the other `preview/*` renderers.

#### Scenario: Audio file renders with native controls
- **GIVEN** a target `{ kind: "file", cwd, path: "assets/chime.mp3" }`
- **WHEN** the audio preview renders
- **THEN** it mounts `<audio controls>` sourced from `/api/file/raw?cwd=&path=assets/chime.mp3`
- **AND** the seek bar works via the endpoint's Range responses
