## Purpose
Ship workflow skills that chain the ArtCraft visual, document, presentation, data and photo apps with existing image and document skills into complete, verified, resumable pipelines for brand assets, publishing, decks, photo processing and data visuals.

## ADDED Requirements

### Requirement: Office workflow skills shipped
The craft-apps package SHALL ship the skills `craft-brand-kit`, `craft-doc-publish`, `craft-deck`, `craft-photo-pipeline` and `craft-data-visual`, declared under `pi.skills`, each with a description naming the job and typical user phrasings, and the `craft-studio` router SHALL list them.

#### Scenario: Workflows discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists all five workflow skills and the router names each one

### Requirement: Step contract, verification gate and resumability
Each workflow skill SHALL present ordered steps naming app or sibling skill, inputs, outputs in the shared hand-off formats (svg, png, tiff, pdf), and a passing `pi-craft verify` gate before the next step; it SHALL store outputs under `craft-jobs/<slug>/NN-<step>/` with a `job.json` progress record and resume at the first unverified step.

#### Scenario: Page count gate
- **WHEN** `craft-doc-publish` combines chapters into a PDF expected to have 24 pages and the result has 23
- **THEN** the verify gate fails and the securing step is not started

### Requirement: Soft references to sibling skills
Workflow skills SHALL detect whether referenced sibling skills (`nano-banana`, `anti-slop-brandkit`, `document-converter`, `deck3d`) are available and, if missing, name the providing package and the degraded path, without adding a package dependency.

#### Scenario: Brand kit without image generation
- **WHEN** `craft-brand-kit` runs and nano-banana is not installed
- **THEN** the agent is told which package provides it and offered to start from a user-supplied logo file
