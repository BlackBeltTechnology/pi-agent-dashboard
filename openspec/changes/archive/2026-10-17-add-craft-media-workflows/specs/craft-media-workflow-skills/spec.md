## Purpose
Ship workflow skills that chain the ArtCraft media apps (FilmCraft, SoundCraft, EffectCraft) with the sibling video-production, video-transcription and music-production skills into complete, verified, resumable media pipelines.

## ADDED Requirements

### Requirement: Media workflow skills shipped
The craft-apps package SHALL ship the skills `craft-video-post`, `craft-beat-cut`, `craft-podcast-master` and `craft-motion-titles`, declared under `pi.skills`, each with a description naming the job and typical user phrasings in double quotes.

#### Scenario: Workflows discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists all four workflow skills, each description contains at least one quoted user phrasing

### Requirement: Step contract and verification gate
Each workflow skill SHALL present its pipeline as ordered steps, each naming the app or sibling skill, its input files and its output files in the shared hand-off formats (wav PCM, mov ProRes 4444 alpha, srt, `music-hits/1` json, mp4 h264/aac). Every step producing a media artefact SHALL be followed by a `pi-craft verify` invocation that must pass before the next step starts; a step producing a text artefact (srt, json) SHALL be followed by the documented skill-level check for that format. The delivery gate SHALL assert `--codec video=h264 --codec audio=aac`. On a failed gate the skill SHALL direct the agent to re-discover the commands used (`describe`) and repeat the step, at most twice, then stop and report — never continue past a failed gate.

#### Scenario: Wrong intermediate duration stops the pipeline
- **WHEN** the SoundCraft mix step produces a wav whose duration differs from the picture length beyond tolerance
- **THEN** the skill's verify gate fails and the FilmCraft assembly step is not started

#### Scenario: Empty caption file stops the caption step
- **WHEN** the srt handed to the caption step contains no cue
- **THEN** the skill-level check fails and no captions are placed

### Requirement: Resumable jobs
Each workflow skill SHALL follow the Craft jobs convention defined in the `craft-studio` router (link, not copy): outputs and project files under `craft-jobs/<slug>/NN-<step>/`, completed steps with their `pi-craft verify --json` reports and recorded inputs in `craft-jobs/<slug>/job.json`, and an explicit resume step instructing the agent to start at the first step without a passing report or whose recorded inputs changed, re-running every step downstream of it.

#### Scenario: Resume after interruption
- **WHEN** a `craft-video-post` job stopped after the mix step passed verification
- **THEN** re-running it starts at the assembly step and reuses the verified mix

#### Scenario: Changed input invalidates downstream steps
- **WHEN** a footage file recorded as an input of the assembly step was replaced after the job completed
- **THEN** re-running the job re-runs the assembly step and every later step instead of reusing their outputs

### Requirement: Soft references to sibling skills
Workflow skills SHALL NOT require sibling packages to be installed. Each workflow's first step SHALL check whether each referenced sibling is available — by the agent's loaded skill list, and by the sibling CLI on PATH where one exists (`pi-transcribe`, `pi-voiceid`, `pi-veo`), plus a runtime probe where the sibling needs one (music venv interpreter, `npx hyperframes --version`) — and, when one is missing, name the package that provides it and the degraded path, or stop when the sibling is essential to the requested job.

#### Scenario: Transcription package missing
- **WHEN** `craft-video-post` is asked for captions and the video-transcription skill is not available
- **THEN** the agent is told which package provides it and offered to continue without captions

#### Scenario: Essential sibling missing
- **WHEN** `craft-beat-cut` runs and `beat-sync-video` is not available
- **THEN** the agent names the `music-production` package and stops instead of guessing beat times

### Requirement: FilmCraft and HyperFrames responsibilities
`craft-video-post` SHALL use FilmCraft for footage timeline assembly, captions and delivery export, and SHALL use the `hyperframes-showreel` skill only for code-driven motion graphics; it SHALL NOT duplicate HyperFrames composition authoring. A HyperFrames render with an alpha channel SHALL be overlaid on a FilmCraft video track above the footage; a render without alpha SHALL be placed as a full-frame segment.

#### Scenario: Code-driven motion requested
- **WHEN** the user asks for an animated data overlay in an edited video and the HyperFrames render passes `pi-craft verify --alpha`
- **THEN** the workflow places it on a FilmCraft video track above the footage and the delivery gate's `--frame-diff` at an overlay time shows a difference against the retained un-overlaid cut

#### Scenario: HyperFrames render without alpha
- **WHEN** the HyperFrames render fails `pi-craft verify --alpha`
- **THEN** the workflow places it as a full-frame segment on the sequence and does not overlay it on the footage
