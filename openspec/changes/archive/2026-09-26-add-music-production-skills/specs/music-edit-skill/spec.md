## Purpose

The `music-edit-to-length` pi skill cuts a music track to a target length on its downbeat grid. It uses scored join candidates, click-free crossfades and verified joins, and emits a video-time beat grid for the picture edit.

## ADDED Requirements

### Requirement: Join candidates are scored per factor
The skill SHALL provide a join-scoring script. It reads a `music-map/1` map and the audio that the map's `source` field references, and for each candidate join (outgoing bar A → incoming bar B) reports:
- 2-bar chroma cosine similarity;
- 2-bar timbre (MFCC) cosine similarity;
- level jump in dB;
- `section_boundary` (B starts a map section);
- `class_change` (the classes of A's and B's sections);
- a composite `score`.

Output SHALL be a table on stdout, plus JSON with `--json`.

#### Scenario: Repeated block scores highest
- **WHEN** a fixture repeats an identical 4-bar block twice
- **AND** a join is scored from the end of the first block back to the start of the first block (a loop-back into identical material)
- **THEN** chroma and timbre similarity are ≥ 0.98
- **AND** that join ranks above a join into a different-texture section

#### Scenario: Genre-boundary splice is penalised
- **WHEN** A lies in a `groove` or `drop` section and B lies in a `breakdown` or `build` section
- **THEN** `class_change` is reported
- **AND** the composite score is lower than an otherwise equal join without a class change

### Requirement: Edit renders on 1-based bars with equal-power joins
The skill SHALL provide an edit script that takes the source audio, an output stem and segments written `start_bar:end_bar`. `end` may be a bar number, `END`, or seconds with a decimal point. It SHALL:
- concatenate the segments with a 30 ms equal-power crossfade centred on each join, or with a hard butt-join when `--no-xfade` is given (diagnostic/test use);
- write `<out>.wav` and `<out>_edit.json` with `"schema": "music-edit/1"`, `source`, `audio`, `map` (all three paths relative to the edit file), `bpm`, `meter`, `duration`;
- write `segments[] {start_bar, end_bar|end_s, music_from, music_to, video_at}`, `joins[] {video_at, source_bar, score, click_ok}` and `downbeats_video[]`;
- with `--preview`, also write `<out>.m4a` for listening.

#### Scenario: Output length matches segments
- **WHEN** segments `1:9` and `17:25` are rendered from a 124 BPM fixture
- **THEN** `duration` is within 40 ms of 16 bars × 1.935 s
- **AND** `downbeats_video` has 16 entries starting at 0.0

#### Scenario: Invalid segment
- **WHEN** a segment's end bar is not after its start bar, or exceeds the grid
- **THEN** the script exits non-zero with a message naming the segment and writes no output

### Requirement: Joins are click-checked and tails trimmed
For each join, the edit script SHALL compare the maximum absolute sample step within ±20 ms of the join in the output with the same measure within ±20 ms of the incoming bar's downbeat in the source. It SHALL set `click_ok` to true only when the edit's value is ≤ 1.1× the source value. When the last segment ends with ≥ 1 s below −50 dBFS, the script SHALL trim the tail to 50 ms after the silence starts and apply a 50 ms fade-out.

#### Scenario: Injected discontinuity is flagged
- **WHEN** a join is rendered with `--no-xfade` between two bars whose waveforms are discontinuous at the join
- **THEN** that join's `click_ok` is false

#### Scenario: Edit file is self-describing
- **WHEN** an edit is rendered
- **THEN** the `audio`, `source` and `map` paths in `_edit.json` resolve, relative to the edit file, to existing files

#### Scenario: Trailing silence removed
- **WHEN** the last segment runs to `END` on a source ending in 5 s of silence
- **THEN** the output duration excludes all but the 50 ms fade of that silence

### Requirement: Skill enforces splice rules and a listening loop
The skill text SHALL instruct the agent to:
- keep the drop as a fixed anchor on the video timeline;
- enter only at section boundaries or at repeated-block boundaries;
- never splice across a genre or energy boundary (for example, from tech-house groove into a trance build);
- render an `.m4a` preview and ask the user to listen before the picture edit is locked to the grid.

Rejected versions SHALL be kept with a `_vN` suffix together with a note of the rejection reason.

#### Scenario: Skill text names the rules
- **WHEN** the skill markdown is read
- **THEN** it contains the fixed-drop-anchor, section-boundary and no-genre-boundary rules and the listen-before-lock step
