# file-and-url-preview — delta

> Stub delta. The rendering path (A′ engine command vs B′ convertToMarkdown) is unresolved
> (see proposal Open Questions); scenarios below fix only the dispatch + on-demand invariants.

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

`dispatchPreview` SHALL map the `.pptx` file extension (compared case-insensitively) to a
`"pptx"` `RendererKind`, keeping dispatch purely shape-based (no server round-trip, MIME sniff,
or read). `RendererKind` SHALL include `"pptx"`.

#### Scenario: PPTX extension
- **WHEN** the file extension is `.pptx`
- **THEN** the result is `"pptx"`

#### Scenario: Unknown file extension unaffected
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: PPTX renders on demand via a rendering engine

The `.pptx` preview SHALL be rendered by a rendering engine (via `document-converter`, whose
image already bundles LibreOffice) rather than an in-process library, and SHALL be **user-
initiated** (an explicit affordance), NOT auto-rendered on the inline `/api/file/render` hot
path — because engine conversion incurs multi-second Docker latency. The rendered output SHALL
reuse an existing renderer (`PdfPreview` or a slide carousel) and SHALL be bounded (slide/size
cap) with a download-original escape hatch. When the engine/image is unavailable, the preview
SHALL degrade to the existing `FallbackPreview` download card with a clear reason.

#### Scenario: PPTX preview is user-initiated, not inline-auto
- **GIVEN** a `.pptx` file in the content area
- **WHEN** it first appears
- **THEN** it does not auto-convert on the inline render path; a "Render slides" affordance is
  offered instead

#### Scenario: Engine unavailable degrades clearly
- **GIVEN** the `document-converter` engine image is not available
- **WHEN** a `.pptx` render is requested
- **THEN** the preview shows the `FallbackPreview` download card with a reason, and no crash
