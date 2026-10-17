## MODIFIED Requirements

<!-- Rebased on add-craft-media-workflows' craft-app-skills delta: that change MUST be archived first. -->

### Requirement: Router skill
The package SHALL ship a `craft-studio` skill that teaches: which app to use for which job (a table covering all 13 apps); the hand-off file formats between apps (audio: wav/aiff; video with alpha: mov ProRes 4444; delivery video: mp4 h264/aac; raster: png/tiff; vector: svg/pdf; documents: pdf/docx); the per-step loop *plan → discover (`commands`/`describe`) → execute → save the project file → `pi-craft verify`*; that command ids must never be guessed; bash route vs MCP route and the confinement and tool-budget policy; and that desktop GUI bridging is out of scope. It SHALL also list the shipped workflow skills with when-to-use guidance (including the FilmCraft vs HyperFrames split) and SHALL define, once, the Craft jobs convention every workflow skill links to: per-job directory `craft-jobs/<slug>/NN-<step>/` with `<slug>` derived from the job name by lower-casing and mapping every character outside `[a-z0-9-]` to `-`, a `craft-jobs/<slug>/job.json` recording completed steps with their verify reports and inputs, and resume at the first step without a passing report or whose recorded inputs changed, re-running every step downstream of it.

#### Scenario: Router is discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists `craft-studio` and its description names ArtCraft craft apps, headless creative work, and choosing an app

#### Scenario: Router lists workflows and the job convention
- **WHEN** an agent reads `craft-studio`
- **THEN** it finds a workflow table naming `craft-video-post`, `craft-beat-cut`, `craft-podcast-master` and `craft-motion-titles`, and a "Craft jobs" section defining `craft-jobs/<slug>/`, `job.json` and the resume rule

#### Scenario: Router lists the office workflows
- **WHEN** an agent reads `craft-studio` after this change
- **THEN** its workflow table also names `craft-brand-kit`, `craft-doc-publish`, `craft-deck`, `craft-photo-pipeline` and `craft-data-visual`, and states that `craft-doc-publish` is the default Markdown-to-templated-DOCX/PDF path while `document-converter` handles ingest, round-trip editing and PlantUML

### Requirement: Skills declared in the package manifest
All 23 skills SHALL be declared under `pi.skills` in the package manifest and included in the published files: the router, 13 app skills, 4 media workflow skills and 5 office workflow skills.

#### Scenario: Packed package contains all skills
- **WHEN** the package is packed
- **THEN** the tarball contains 23 `SKILL.md` files under `.pi/skills/`
