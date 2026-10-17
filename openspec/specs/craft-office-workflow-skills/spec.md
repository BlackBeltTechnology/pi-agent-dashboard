# craft-office-workflow-skills Specification

## Purpose
Ship workflow skills that chain the ArtCraft visual, document, presentation, data and photo apps with existing image and document skills into complete, verified, resumable pipelines for brand assets, publishing, decks, photo processing and data visuals.

## Requirements

### Requirement: Office workflow skills shipped
The craft-apps package SHALL ship the skills `craft-brand-kit`, `craft-doc-publish`, `craft-deck`, `craft-photo-pipeline` and `craft-data-visual`, declared under `pi.skills`, each with a description naming the job and typical user phrasings in double quotes, and the `craft-studio` router SHALL list them in a workflow table with when-to-use guidance.

#### Scenario: Workflows discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists all five workflow skills and the router's workflow table names each one

### Requirement: Step contract and verification gate
Each workflow skill SHALL present ordered steps naming the app or sibling skill, the inputs, and the outputs in the hand-off formats (svg, png, tiff, pdf, docx). The next step SHALL start only after the previous step's gate passes. Every artefact-producing step SHALL end with a `pi-craft verify` gate, with two exceptions:
- the W6 prepare step, whose gate is the `pi-craft doc prepare` exit code and report;
- the GridCraft read-back, which is a skill-level check.

SVG outputs SHALL be gated through a rasterised png preview, never by passing the `.svg` to verify. `--alpha` SHALL be asserted on png only. On gate exit `1` the skill SHALL direct the agent to re-discover the commands used and repeat the step, at most 2 times, then stop and report. On gate exit `3` (probe tool unavailable) the skill SHALL stop and report the missing tool, never treating it as a pass.

#### Scenario: Page count gate
- **WHEN** `craft-doc-publish` combines chapters into a PDF expected to have 24 pages and the result has 23
- **THEN** `pi-craft verify` exits `1` and the protect step is not started

#### Scenario: Probe tool unavailable
- **WHEN** a PDF gate runs and PdfCraft cannot be provisioned so `pi-craft verify` exits `3`
- **THEN** the agent reports that pdfcraft is unavailable and does not continue to the next step

### Requirement: Resumable jobs
Each workflow SHALL follow the Craft jobs convention defined once in the `craft-studio` router: `craft-jobs/<slug>/NN-<step>/`, `job.json` with steps, reports and inputs, and resume at the first step without a passing report or with changed inputs. Each workflow SHALL link to that convention instead of redefining it. The W6 prepare step SHALL record its `prepare.json` summary as its report. Passwords and API keys SHALL NOT be written to `job.json` or gate reports.

#### Scenario: Resume after interruption
- **WHEN** a `craft-doc-publish` job stopped after the render step was verified and before the PdfCraft protect step
- **THEN** re-running it starts at the protect step and reuses the verified pdf

#### Scenario: Protect password not persisted
- **WHEN** the PdfCraft protect step runs with a user-supplied password
- **THEN** `job.json` records the step and its gate report without the password

### Requirement: Soft references to sibling skills
Workflow skills SHALL NOT add a new package dependency on a sibling package; the existing nano-banana dependency is unchanged. Step 0 SHALL check each referenced sibling: `anti-slop-brandkit`, `document-converter` and `deck3d` in the loaded skill list, `pi-nano-banana` credentials, and `mmdc` on PATH. For each one missing, it SHALL name the providing package and the degraded path from design D5.

#### Scenario: Brand kit without image generation credentials
- **WHEN** `craft-brand-kit` runs and `pi-nano-banana` has no usable credentials
- **THEN** the agent is told so and offered to start from a user-supplied logo file

### Requirement: Brand kit respects brandkit opt-in
`craft-brand-kit` SHALL start from a user-supplied logo by default: an svg is used directly; a raster logo is traced with VectorCraft `imageTrace`. It SHALL invoke `anti-slop-brandkit` only on explicit user request, under that skill's own rules, unchanged. It SHALL use a brandkit concept as its logo input only after the user approves that concept, and SHALL label derived assets as concepts until the user approves the brand.

#### Scenario: Brandkit not requested
- **WHEN** the user asks for a brand kit and provides `logo.png`
- **THEN** the workflow traces `logo.png` with VectorCraft and does not run `anti-slop-brandkit` or any paid image generation

#### Scenario: Brandkit requested without confirmation
- **WHEN** the user asks for a brand kit with generated logo concepts but has not confirmed the generation plan
- **THEN** no image is generated and the workflow waits for confirmation

### Requirement: Document publishing is the default Markdown-to-DOCX/PDF path
`craft-doc-publish` SHALL render Markdown with frontmatter into a templated DOCX and PDF by running `pi-craft doc prepare`. It SHALL then open the filled template with WordCraft `run --file`, not `--template`, append the prepared body after a page break, optionally insert and update a TOC, set document properties, and export a PDF, all in one gated step. The prepare gate SHALL fail when the report shows unresolved placeholders, unrendered Mermaid blocks, skipped or remote images, or template-defaulted variables the user has not confirmed, unless the user accepts the degradation. It SHALL echo the resolved template path. It SHALL refer ingest/OCR, round-trip editing, PlantUML and table-width profiles to `document-converter`.

#### Scenario: Templated PDF from Markdown
- **WHEN** `report.md` with frontmatter `document_title`, `client_name` and `enable_toc: true` is published with the `default` template
- **THEN** the PDF carries the template's cover with `client_name` filled, a TOC, the body in template styles, and passes `pi-craft verify --text-contains "<document_title>"`

#### Scenario: Template default needs confirmation
- **WHEN** prepare reports `client_name` under `defaulted`
- **THEN** the agent shows the default value and asks the user to confirm or supply a value before the render step

#### Scenario: Unrendered diagram stops the pipeline
- **WHEN** prepare reports `mermaid.unrendered: 1` because `mmdc` is missing
- **THEN** the agent asks the user to install `mmdc` or accept code-block diagrams before the render step starts

#### Scenario: Round-trip edit requested
- **WHEN** the user asks to extract a DOCX to Markdown, edit it and merge it back
- **THEN** the skill routes to `document-converter` instead of WordCraft

### Requirement: Data visual read-back gate
`craft-data-visual` SHALL, before exporting a chart, read back the chart's source range with the `gridcraft-cli cat --range` subcommand. It SHALL fail the step when any cell shows a spreadsheet error value: `#NAME?`, `#DIV/0!`, `#REF!`, `#VALUE!`, `#N/A`, `#NUM!` or `#NULL!`.

#### Scenario: Formula error caught
- **WHEN** the chart's source range contains a `#DIV/0!` cell and GridCraft exits `0`
- **THEN** the read-back gate fails and no chart is exported

### Requirement: Deck renderers are alternatives
`craft-deck` SHALL produce the deck either with DeckCraft (pptx/pdf) or with `deck3d` (HTML), per the user's choice. It SHALL NOT convert between the two.

#### Scenario: HTML deck requested
- **WHEN** the user asks for a 3D web presentation from an outline
- **THEN** the workflow uses `deck3d` and skips the DeckCraft and PdfCraft steps
