# craft-app-skills Specification

## Purpose
Ship the pi skills that let an agent choose the right ArtCraft Crafting App for a job and drive it correctly headless: one router skill shared by all apps, one skill per app capturing that app's CLI dialect, document model, traps and verified recipes, and an automated check that keeps quoted command ids in sync with the real apps.

## Requirements

### Requirement: Router skill
The package SHALL ship a `craft-studio` skill that teaches: which app to use for which job (a table covering all 13 apps); the hand-off file formats between apps (audio: wav/aiff; video with alpha: mov ProRes 4444; delivery video: mp4 h264/aac; raster: png/tiff; vector: svg/pdf; documents: pdf/docx); the per-step loop *plan → discover (`commands`/`describe`) → execute → save the project file → `pi-craft verify`*; that command ids must never be guessed; bash route vs MCP route and the confinement and tool-budget policy; and that desktop GUI bridging is out of scope.

#### Scenario: Router is discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists `craft-studio` and its description names ArtCraft craft apps, headless creative work, and choosing an app

### Requirement: One skill per app
The package SHALL ship one skill per supported app (13 skills), each teaching: what the app is for and its file formats; the exact CLI dialect (how to list/describe commands, run single and multiple commands, script files, open/save project files); how state persists between invocations; the discovery commands to use before any command id; known traps observed in testing; and two to four minimal recipes that end with a `pi-craft verify` call. Each skill description SHALL name the app, its domain and typical user phrasings.

#### Scenario: FilmCraft skill covers the playhead trap
- **WHEN** the filmcraft skill is read
- **THEN** it states that `source.overwrite`/`source.insert` place media at the current playhead and that recipes set it explicitly with `playhead.set` before each placement

#### Scenario: PdfCraft dialect
- **WHEN** the pdfcraft skill is read
- **THEN** it uses `pdfcraft-cli tools` (not `commands`) for discovery

### Requirement: Recipes are verified
Every recipe in the router and app skills SHALL end with a `pi-craft verify` invocation asserting at least one property of its output.

#### Scenario: Recipe without verification is rejected
- **WHEN** the skill lint test finds a recipe code block that produces an output file and has no `pi-craft verify` line
- **THEN** the test fails naming the skill and recipe

### Requirement: Skill drift check
A test SHALL extract every command id quoted in skill code blocks and check it against the app's command list for the registry-pinned test version: offline against recorded command-list fixtures (unit test), and against real provisioned binaries in the nightly job. An unknown id SHALL fail the test naming the skill, the id and the app version.

#### Scenario: Renamed command upstream
- **WHEN** a new pinned FilmCraft version no longer has `playhead.set`
- **THEN** the nightly drift check fails naming the filmcraft skill, `playhead.set` and the version

### Requirement: Skills declared in the package manifest
All 14 skills SHALL be declared under `pi.skills` in the package manifest and included in the published files.

#### Scenario: Packed package contains all skills
- **WHEN** the package is packed
- **THEN** the tarball contains 14 `SKILL.md` files under `.pi/skills/`
