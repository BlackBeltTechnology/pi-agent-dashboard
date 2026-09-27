## Purpose

The `hyperframes-showreel` pi skill turns real screen and warehouse footage into a rhythmic showreel rendered with HyperFrames. Veo is used only for additive FX layers. The skill pins the known HyperFrames pitfalls and the export QA gates.

## ADDED Requirements

### Requirement: End-to-end pipeline order
The skill SHALL prescribe this order:
1. footage sampling with contact sheets;
2. edit script (acts, shots, source timecodes);
3. clip cutting with redaction baked in (via `footage-redaction`);
4. a generated HyperFrames composition, pass 1 (shot table → scene sub-compositions, provisional scene durations);
5. optional Veo FX layers;
6. `hyperframes check` and snapshots;
7. preview and user review;
8. music edit (via `music-edit-to-length`), then punches (via `beat-sync-video`), then generation pass 2: the generator is re-run with scene starts from `_edit.json`, punches from `_hits.json`, and root duration = edit duration;
9. delivery render;
10. export QA;
11. upload.

#### Scenario: Pipeline documented
- **WHEN** the skill markdown is read
- **THEN** the steps appear in that order, and steps 3 and 8 name `footage-redaction`, `music-edit-to-length` and `beat-sync-video`
- **AND** step 8 requires regenerating the composition

#### Scenario: Music skills not installed
- **WHEN** the music-production skills are not available in the session
- **THEN** the skill's procedure names the package to install, and otherwise continues with the unedited music and no punches

### Requirement: Real footage is never replaced by AI
The skill SHALL state that every process shown on screen comes from real footage. Veo output SHALL be used only as additive FX layers (black background, screen blend). No AI insert may depict a process that has no footage.

#### Scenario: Rule present
- **WHEN** the skill markdown is read
- **THEN** it contains the footage-only rule and the screen-blend FX-layer rule

### Requirement: HyperFrames pitfalls are pinned
The skill SHALL document:
- **(a)** Install scope. The default follows the upstream installer (`npx hyperframes skills update` into `~/.agents/skills`, which pi reads), as documented by the repo's HyperFrames doc. Only when the user wants project-only scope: after every `init`, `init --skill` or `skills update` (including the router's lazy workflow installs), copy the installed dirs into the user project's `.pi/skills`. The global store SHALL NOT be modified by default. It is machine-wide and other projects may use it, and the router re-installs into it lazily anyway. The skill SHALL warn that project and global copies may then coexist at different versions. Removing global copies is allowed only after the user explicitly confirms that no other project uses them, and only for the dirs and lock entries the call just created. This never applies to this repository's own `.pi/skills`.
- **(b)** `mix-blend-mode` and any `opacity` go on the FX wrapper, never opacity on a wrapper whose inner video carries the blend.
- **(c)** Every `<audio>` element needs an `id`, or the render is silent.
- **(d)** Generated composition files are never hand-edited; edits go into the generator and it is re-run.
- **(e)** A snapshot landing exactly on a flash tween looks washed out, and this is expected.

The skill SHALL reference HyperFrames only by its public CLI and SHALL NOT vendor its skills or code.

#### Scenario: Global store untouched by default
- **WHEN** the skill markdown's project-scope procedure is read
- **THEN** it copies into the project and gates any global removal behind explicit user confirmation

#### Scenario: Pitfalls listed
- **WHEN** the skill markdown is read
- **THEN** items (a)–(e) are each present

### Requirement: Export QA gate
Before a render is reported as done, the skill SHALL require:
- an ffprobe check of streams, resolution, fps and duration against the music edit duration (±0.1 s);
- an integrated-loudness and true-peak measurement (ffmpeg `loudnorm` analysis), reported with the platform note (−14 LUFS for web platforms);
- a frame-strip visual check at the drop and at the end card.

#### Scenario: QA commands present
- **WHEN** the skill markdown is read
- **THEN** it contains the ffprobe, loudnorm and frame-strip commands with their pass criteria

### Requirement: Generator pattern reference
The skill SHALL ship a reference describing the generator structure:
- a shot table per scene;
- scene HTML emitted per sub-composition;
- root length equal to the music edit duration;
- scene starts from `_edit.json`;
- punches from `_hits.json`.

It SHALL NOT ship a project-bound generator script.

#### Scenario: Reference exists
- **WHEN** the skill directory is listed
- **THEN** `references/generator-pattern.md` exists and the SKILL.md links to it
