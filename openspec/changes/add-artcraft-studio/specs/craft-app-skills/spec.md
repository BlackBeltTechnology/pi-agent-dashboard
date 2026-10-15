## MODIFIED Requirements

### Requirement: Router skill
The package SHALL ship a `craft-studio` skill that teaches: which app to use for which job (a table covering all 13 apps); the hand-off file formats between apps (audio: wav/aiff; video with alpha: mov ProRes 4444; delivery video: mp4 h264/aac; raster: png/tiff; vector: svg/pdf; documents: pdf/docx); the per-step loop *plan → discover (`commands`/`describe`) → execute → save the project file → `pi-craft verify`*; that command ids must never be guessed; bash route vs MCP route and the confinement and tool-budget policy; that desktop GUI bridging of the Crafting Apps is out of scope; and that handing a file to the ArtCraft studio desktop app is covered by the `artcraft-studio` skill.

#### Scenario: Router is discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists `craft-studio` and its description names ArtCraft craft apps, headless creative work, and choosing an app

#### Scenario: Router points to ArtCraft studio
- **WHEN** the `craft-studio` skill is read
- **THEN** it names the `artcraft-studio` skill for ArtCraft studio hand-off

### Requirement: Skills declared in the package manifest
All 15 skills (the `craft-studio` router, the 13 per-app skills and `artcraft-studio`) SHALL be declared under `pi.skills` in the package manifest and included in the published files. `artcraft-studio` is neither the router nor an app skill: it quotes no app command ids and contains no output-producing recipes, so the recipe-verification and drift checks do not cover it.

#### Scenario: Packed package contains all skills
- **WHEN** the package is packed
- **THEN** the tarball contains 15 `SKILL.md` files under `.pi/skills/`, including `artcraft-studio`

### Requirement: Skill drift check
A test SHALL extract every command id quoted in the code blocks of the router and app skills and check it against the app's command list for the registry-pinned test version: offline against recorded command-list fixtures (unit test), and against real provisioned binaries in the nightly job. An unknown id SHALL fail the test naming the skill, the id and the app version. The `artcraft-studio` skill is not an app skill and is not drift-checked.

#### Scenario: Renamed command upstream
- **WHEN** a new pinned FilmCraft version no longer has `playhead.set`
- **THEN** the nightly drift check fails naming the filmcraft skill, `playhead.set` and the version

#### Scenario: ArtCraft studio skill not drift-checked
- **WHEN** the `artcraft-studio` skill quotes `pi-craft artcraft open frame.png` in a code block
- **THEN** the drift check does not treat it as an app command id
