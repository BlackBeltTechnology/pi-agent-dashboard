## Purpose
Ship workflow skills that chain the ArtCraft media apps (FilmCraft, SoundCraft, EffectCraft) with the existing video-production, video-transcription and music-production skills into complete, verified, resumable media pipelines.

## ADDED Requirements

### Requirement: Media workflow skills shipped
The craft-apps package SHALL ship the skills `craft-video-post`, `craft-beat-cut`, `craft-podcast-master` and `craft-motion-titles`, declared under `pi.skills`, each with a description naming the job and typical user phrasings, and the `craft-studio` router SHALL list them with when-to-use guidance.

#### Scenario: Workflows discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists all four workflow skills and the router names each one

### Requirement: Step contract and verification gate
Each workflow skill SHALL present its pipeline as ordered steps, each naming the app or sibling skill, its input files, its output files in the shared hand-off formats (wav, mov ProRes 4444 alpha, srt, mp4 h264/aac), and a `pi-craft verify` invocation that must pass before the next step starts. On a failed verification the skill SHALL direct the agent to re-discover the commands used (`describe`) and repeat the step, not continue.

#### Scenario: Wrong intermediate duration stops the pipeline
- **WHEN** the SoundCraft mix step produces a wav whose duration differs from the picture length beyond tolerance
- **THEN** the skill's verify gate fails and the FilmCraft assembly step is not started

### Requirement: Resumable jobs
Each workflow SHALL write its outputs and project files under `craft-jobs/<slug>/NN-<step>/` and record completed steps with their verify reports in `craft-jobs/<slug>/job.json`; re-running the workflow SHALL resume at the first step without a passing verify report.

#### Scenario: Resume after interruption
- **WHEN** a `craft-video-post` job stopped after the mix step passed verification
- **THEN** re-running it starts at the assembly step and reuses the verified mix

### Requirement: Soft references to sibling skills
Workflow skills SHALL NOT require sibling packages to be installed. Each workflow's first step SHALL check whether each referenced sibling skill or CLI is available and, when one is missing, name the package that provides it and the degraded path (or stop, when the sibling is essential to the requested job).

#### Scenario: Transcription package missing
- **WHEN** `craft-video-post` is asked for captions and the video-transcription skill is not installed
- **THEN** the agent is told which package provides it and offered to continue without captions

### Requirement: FilmCraft and HyperFrames responsibilities
`craft-video-post` SHALL use FilmCraft for footage timeline assembly and delivery export, and SHALL use HyperFrames only for code-driven motion graphics rendered to alpha video and overlaid in FilmCraft; it SHALL NOT duplicate HyperFrames composition authoring.

#### Scenario: Code-driven motion requested
- **WHEN** the user asks for an animated data overlay in an edited video
- **THEN** the workflow renders the overlay via the hyperframes skill to mov with alpha and places it on a FilmCraft video track above the footage
