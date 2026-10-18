## MODIFIED Requirements

### Requirement: Python engine runs inside a Docker image
The system SHALL package the Python engine (`document_converter`, docling,
python-docx, python-pptx, openpyxl, pandoc, Gotenberg, mermaid-cli, the nano-banana
CLI, a headless browser, frontmatter-filler, markdown-table-profiler) in a single
Docker image (`pi-doc-engine`). No host Python toolchain SHALL be required. The
runtime image MUST NOT reference any home-directory (`~/Documents`) path. The image
SHALL build and run on both `amd64` and `arm64` hosts, and the bundled browser SHALL
be native to the architecture the image was built for. The build SHALL select the
browser from the architecture it is building for and SHALL fail for any architecture
it has no branch for, rather than defaulting to one. A build that cannot provision a
working browser for its architecture SHALL fail rather than produce an image that
fails at conversion time.

#### Scenario: Conversion runs with no host Python
- **WHEN** the facade runs on a machine with Docker but no Python
- **THEN** conversion succeeds via the `pi-doc-engine` image
- **AND** no host `python`, `pip`, or venv is invoked

#### Scenario: Image is self-contained
- **WHEN** the image is built from the repo-vendored engine copy
- **THEN** it contains all converters and CLIs and references no home-dir path

#### Scenario: Image built on an arm64 host is natively executable
- **WHEN** the image is built on an `arm64` host
- **THEN** the bundled browser is an `arm64` binary
- **AND** it launches and renders a diagram during the build without x86-64 emulation

#### Scenario: Unsupported build architecture fails loudly
- **WHEN** an image build runs on an architecture with no browser branch
- **THEN** the build fails naming the detected architecture
- **AND** no browser intended for another architecture is installed

#### Scenario: Unprovisionable browser fails the build
- **WHEN** an image build cannot install or launch a browser for its architecture
- **THEN** the build fails and no image is tagged

### Requirement: Diagram rendering with mmdc default
The system SHALL render Mermaid (and PlantUML) diagram blocks to images during DOCX/PDF
production, using mmdc by default. A browser bundled in the image SHALL be used so
host-Chrome conflicts do not occur, and that browser SHALL be native to the image's
architecture so diagrams render successfully on both `amd64` and `arm64`; raster
output MAY differ between the two (different browser builds). When a diagram render
is attempted and fails because the bundled browser could not be launched, the system
SHALL report a diagnostic that is distinct from a diagram-content failure and that
names the browser-launch cause. A produce call that fails without attempting a
diagram render SHALL NOT report that diagnostic.

#### Scenario: Mermaid block rendered by default
- **WHEN** a document with a ` ```mermaid ` block is produced without the styled flag
- **THEN** mmdc renders the diagram to an embedded image with no host Chrome involved

#### Scenario: Mermaid renders on arm64
- **WHEN** a document with a ` ```mermaid ` block is produced by an image built on an `arm64` host
- **THEN** the diagram renders and the produce call succeeds

#### Scenario: Unlaunchable browser is diagnosed distinctly
- **WHEN** diagram rendering fails because the bundled browser could not be launched
- **THEN** the facade rejects with a browser-unavailable error code
  (`MMDC_UNAVAILABLE`) distinct from the generic produce-failure code
- **AND** the error message identifies the browser launch failure without the caller
  parsing stderr
- **AND** the error message contains the probed browser executable path and the
  machine architecture

#### Scenario: Non-diagram failure is not attributed to the browser
- **WHEN** a produce call fails before or without rendering any diagram
  (e.g. the document has no diagram block), even if the bundled browser cannot launch
- **THEN** the facade rejects with the generic produce-failure code, not the
  browser-unavailable code

#### Scenario: Invalid diagram still reports a produce failure
- **WHEN** diagram rendering fails because the diagram source is invalid while the
  browser launches normally
- **THEN** the facade rejects with the generic produce-failure code, not the
  browser-unavailable code

### Requirement: Styled diagram rendering via nano-banana with cache and fallback
The system SHALL, when a document opts in via frontmatter
`nano_banana: {enabled: true, style: <name>}`, replace each Mermaid block with a cached
image keyed by the md5 of the diagram source text (`.mermaid-cache/<md5>.png`), generating
misses via the nano-banana CLI using a named style. The styled render SHALL be generated
from the Mermaid source text and SHALL NOT require mmdc. The cache SHALL make repeated
renders deterministic. On any nano-banana failure the system SHALL fall back to mmdc;
the document SHALL still produce successfully whenever mmdc can render, and when mmdc
itself cannot render the system SHALL fail the produce call with the diagnostic defined
by `Requirement: Diagram rendering with mmdc default`.

#### Scenario: Cache hit reuses image
- **WHEN** a styled diagram with an unchanged source is produced a second time
- **THEN** the cached `.mermaid-cache/<md5>.png` is reused and the CLI is not called

#### Scenario: Missing GEMINI_API_KEY falls back to mmdc
- **WHEN** styled rendering is requested but `GEMINI_API_KEY` is absent or the CLI fails,
  and the bundled browser launches normally
- **THEN** the system renders the diagram with mmdc and the document still produces successfully

#### Scenario: Styled fallback with an unlaunchable browser fails the produce call
- **WHEN** styled rendering falls back to mmdc and the bundled browser cannot be launched
- **THEN** the produce call fails with the browser-unavailable code, not a silently
  diagram-less document

#### Scenario: Default off stays mmdc
- **WHEN** a document does not set `nano_banana.enabled`
- **THEN** diagrams render with plain mmdc

#### Scenario: Styled render needs no mmdc
- **WHEN** styled rendering succeeds via the nano-banana CLI
- **THEN** the diagram image is produced without invoking mmdc for that block
