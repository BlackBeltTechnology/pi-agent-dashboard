## Purpose

The `music-analysis` pi skill and its scripts turn a local audio file into a machine-readable music map. The map holds tempo, the downbeat cut grid, key, spectrum, style tags, stems and sections. Editing and video-sync skills consume it.

## ADDED Requirements

### Requirement: Quick-tier analysis writes a versioned music map
The skill SHALL provide a quick-tier analysis script that needs only the core requirements set. Given a local audio file path, it SHALL write `<stem>_map.json` and `<stem>_analysis.png` next to the input, or into `--out-dir`.

The map SHALL carry:
- `"schema": "music-map/1"`;
- `source` (the analysed audio file, relative to the map file);
- `duration`, `sr`;
- `tempo {bpm, methods{...}}`;
- `cut_grid {source, meter, downbeats[]}`;
- `beats[]`, `key {label, strength}`;
- `band_level_db_rel {sub, bass, low_mid, high_mid, air}`;
- `sections[]`;
- `drops[]`.

All times SHALL be seconds rounded to 3 decimals.

#### Scenario: Click track analysed
- **WHEN** the quick analysis runs on a synthetic 124 BPM 4/4 click track with accented downbeats
- **THEN** `tempo.bpm` is within ±1 of 124
- **AND** consecutive `cut_grid.downbeats` intervals are within ±30 ms of 1.935 s
- **AND** `cut_grid.source` is `"librosa"`

#### Scenario: Missing dependency
- **WHEN** a required Python module is not importable
- **THEN** the script exits with code 2
- **AND** prints one stderr line naming the missing module and the requirements file to install

### Requirement: Deep-tier analysis enriches the same map
The skill SHALL provide a deep-tier script, run from a separate deep-tier venv, that merges into an existing `<stem>_map.json` or creates it. The deep tier SHALL add:
- per-method tempo entries;
- a beat_this downbeat grid, which SHALL replace `cut_grid` with `source: "beat_this"`;
- a 3-profile key vote;
- `tags {genre, instrument, mood}` as top-k `{label, p}` lists;
- `stems {dir, energy_share{}, bar_rms_db{}}`, where `dir` is relative to the map file.

Model files that the skill fetches itself (the tag classifiers) SHALL be downloaded only from a fixed built-in URL list into a user cache directory, never into the project. Third-party libraries (stem separation, beat tracking) manage their own weight caches. The skill SHALL name those libraries and their cache locations. The skill SHALL warn that the tag-classifier models are licensed non-commercial (CC BY-NC-SA 4.0), and SHALL name the quick tier plus stems without tags as the path for commercial deliverables.

When the deep tier replaces `cut_grid`, it SHALL re-derive every bar-indexed field against the new grid: `sections[].start_bar`/`end_bar`, `drops[].bar`, `tempo.stable_span`, and the per-bar stem arrays. Time-valued quick-tier fields SHALL be preserved. The deep script SHALL locate the map with `--map <path>`, defaulting to `<stem>_map.json` next to the input.

#### Scenario: Deep run upgrades the cut grid
- **WHEN** the deep script runs on a file whose map has `cut_grid.source = "librosa"`
- **THEN** the rewritten map has `cut_grid.source = "beat_this"`
- **AND** the time-valued quick-tier fields are preserved

#### Scenario: Bar fields follow the new grid
- **WHEN** the new grid has one more leading downbeat than the librosa grid
- **THEN** each section's `start_bar` satisfies `cut_grid.downbeats[start_bar-1]` within one beat of the section's `start`

#### Scenario: Too little rhythm
- **WHEN** the input yields fewer than 8 downbeats
- **THEN** the script exits non-zero with a "too short or arrhythmic" message and writes no map

#### Scenario: Stems path is portable
- **WHEN** the project directory is moved after a deep run
- **THEN** `stems.dir` still resolves relative to the map file's directory

### Requirement: Authoritative tempo derives from the downbeat grid
`tempo.bpm` SHALL be computed from the mean downbeat interval over the grid's stable span, not from a median inter-beat interval. It SHALL use the grid's `meter` (beats per bar), not an assumed 4. The stable span is the longest run of downbeat intervals within ±5 % of their median, and SHALL be recorded as `tempo.stable_span {start_bar, end_bar}`. Per-method estimates SHALL be kept under `tempo.methods`.

#### Scenario: Frame-quantized method disagrees
- **WHEN** one method's median-IBI BPM differs from the grid-mean BPM by more than 1 BPM
- **THEN** `tempo.bpm` equals the grid-mean value
- **AND** the disagreeing value appears only under `tempo.methods`

### Requirement: Bars are 1-based
Every bar number the skill emits or accepts SHALL be 1-based: bar *n* begins at `cut_grid.downbeats[n-1]`.

#### Scenario: Section bars
- **WHEN** a section begins at the first downbeat
- **THEN** its `start_bar` is 1

### Requirement: Sections carry a class and drops are candidates
Each `sections[]` entry SHALL have `start`, `end`, `start_bar`, `end_bar`, `rms_db`, `bass_db` and `class` (one of `intro|groove|breakdown|build|drop|outro`). The class SHALL be derived from stem activity when stems exist; otherwise from RMS and bass energy. `drops[]` SHALL list candidates `{time, bar, confidence}` sorted by confidence. Candidates SHALL be section starts with a positive RMS or 30–150 Hz jump against the preceding 2 bars. Confidence SHALL be in [0, 1] and SHALL scale with the gain sustained over the following 2 bars in the 30–150 Hz band, plus the drum-stem re-entry gain when stems exist. A section start whose low-band gain is not sustained over the following 2 bars SHALL have confidence < 0.5. The skill text SHALL instruct the agent to confirm a drop by listening, or by checking stem activity, before using it as an edit anchor.

#### Scenario: Breakdown is not the only drop candidate
- **WHEN** a fixture has a loud breakdown followed by a bass-and-drums re-entry
- **THEN** the bass-and-drums re-entry appears in `drops[]` with a higher confidence than the breakdown start

### Requirement: Python environments are user-installed from pinned requirements
The package SHALL ship `requirements-core.txt` (quick tier) and `requirements-mir.txt` (deep tier) at the package root, with every requirement pinned to an exact version. The skill SHALL instruct the agent to create project-local venvs with `uv` from those files, using a separate venv for the deep tier. No script SHALL install packages itself.

#### Scenario: Every requirement pinned
- **WHEN** both requirements files are parsed
- **THEN** every requirement line uses an exact `==` pin (a `.*` suffix is allowed only for the torch/torchaudio pair)

### Requirement: Model downloads are verified
Skill-fetched model files SHALL be fetched only from a built-in table of URLs with sha256 digests, into the user cache directory. A file whose digest does not match, or which exceeds the size cap, SHALL be deleted, and the script SHALL exit non-zero without loading it.

#### Scenario: Corrupted model file
- **WHEN** a cached model file's sha256 does not match the table
- **THEN** the file is deleted and the script exits non-zero naming the model

### Requirement: No-rip audio sourcing rule
The skill SHALL state that it analyses only local audio files supplied by the user. It SHALL NOT instruct downloading or extracting audio from streaming services, and SHALL NOT name stream-ripping tools. It SHALL list acceptable sources: a purchased file, a file from the artist, or the user's own recording (with the ffmpeg audio-extraction and gain-check commands).

#### Scenario: Skill text contains no ripping tool
- **WHEN** every file under the music-production package's `.pi/` and `lib/` directories is searched case-insensitively for `spotdl`, `yt-dlp`, `youtube-dl`, `savefrom`, `spotify-dl` or `ytmp3`
- **THEN** there are no matches

#### Scenario: No personal or client coupling
- **WHEN** the same trees (and the two new video-production skill directories) are searched for `/Users/`, `Projektek`, `railcargo`, `becton`, `blackbelt.hu`
- **THEN** there are no matches

#### Scenario: Quiet-recording procedure documented
- **WHEN** the skill markdown is read
- **THEN** it contains the peak check (ffmpeg `volumedetect`), the rule to gain a source peaking below −12 dBFS up to about −2 dBFS before analysis, and the rule to note the applied gain
