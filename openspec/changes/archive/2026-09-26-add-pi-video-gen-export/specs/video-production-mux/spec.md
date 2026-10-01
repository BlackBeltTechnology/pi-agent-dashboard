## Purpose

Produce the final master mp4 of a sidecar-enabled shot package by locally mixing a picture-edit video with the official voiceover, music and captions declared in `timeline.json` — the audio stage that the external picture-edit timeline cannot express.

## ADDED Requirements

### Requirement: Mux inputs

`mux <target> --picture <mp4>` SHALL require a sidecar-enabled package without sidecar problems of scope `timeline` or `audio` (other scopes are reported as warnings) whose `timeline.json` exists and declares at least one of `voiceover`, `music` or `captions`, and an existing picture file. It SHALL fail without writing output otherwise.

#### Scenario: Shot problem does not block mux

- **WHEN** the only sidecar problem is a missing shot sidecar (scope `shot`)
- **THEN** mux proceeds and lists the problem as a warning

#### Scenario: No timeline.json

- **WHEN** the package has no `timeline.json`
- **THEN** mux fails with `timeline.json required for mux`

#### Scenario: No timeline audio or captions

- **WHEN** `timeline.json` declares none of `voiceover`, `music`, `captions`
- **THEN** mux fails with `timeline.json declares no voiceover, music or captions`

#### Scenario: Picture missing

- **WHEN** `--picture` is absent or the file does not exist
- **THEN** mux fails naming the picture path

### Requirement: Tool availability

When `ffmpeg` or `ffprobe` cannot be executed, mux SHALL fail with a message naming the missing tool and SHALL leave no file at the output path.

#### Scenario: ffmpeg not found

- **WHEN** `ffmpeg` cannot be executed
- **THEN** mux fails with a message naming `ffmpeg` and no output file exists

### Requirement: Audio mix

The output audio SHALL be the sum of: the picture's own audio (if it has an audio stream) at volume 1; the voiceover delayed by `offsetSec` at its `volume`; the music at its `volume`; followed by a limiter, padded with silence to the picture length. The output duration SHALL equal the picture duration (music longer than the picture is cut). Mux SHALL fail when `voiceover.offsetSec` plus the voiceover's duration exceeds the picture duration, so the voiceover is never truncated. Video SHALL be stream-copied unless captions are burned.

#### Scenario: Picture with ambient audio

- **WHEN** the picture has an audio stream and the timeline declares voiceover and music
- **THEN** the output audio mixes all three and the output duration equals the picture duration

#### Scenario: Silent picture

- **WHEN** the picture has no audio stream
- **THEN** the mix uses only voiceover and music, mux succeeds, and the output audio lasts the full picture duration

#### Scenario: Voiceover offset

- **WHEN** `voiceover.offsetSec` is 1.5
- **THEN** the voiceover starts 1.5 s into the output

#### Scenario: Voiceover longer than the picture

- **WHEN** `offsetSec` plus the voiceover duration exceeds the picture duration
- **THEN** mux fails naming both durations and writes nothing

#### Scenario: Video stream copied

- **WHEN** captions are not burned
- **THEN** the output video stream is identical in codec and resolution to the picture's

### Requirement: Captions

When `captions` is declared, mux SHALL add the SRT as a soft `mov_text` subtitle track by default, with cue times unchanged (the SRT is authored in the output time base; `voiceover.offsetSec` does not shift it). With `--burn` it SHALL render the captions into the video, and SHALL fail before encoding if the resolved ffmpeg lacks the `subtitles` filter. The captions file path SHALL never be interpreted as ffmpeg filter syntax.

#### Scenario: Soft captions

- **WHEN** captions are declared and `--burn` is not set
- **THEN** the output contains a subtitle stream

#### Scenario: Captions not shifted by voiceover offset

- **WHEN** `voiceover.offsetSec` is 2 and the first SRT cue starts at 00:00:02,500
- **THEN** the first subtitle in the output starts at 2.5 s

#### Scenario: Captions only

- **WHEN** only `captions` is declared
- **THEN** the output keeps the picture's audio unchanged (or has no audio if the picture has none) and contains the subtitle stream

#### Scenario: Burn without subtitles filter

- **WHEN** `--burn` is set and ffmpeg lacks the `subtitles` filter
- **THEN** mux fails with a message naming the missing filter and writes nothing

#### Scenario: Burn with filter metacharacters in the path

- **WHEN** `--burn` is set and the captions path is `captions/vo,a:b;'c.srt` inside the package
- **THEN** the captions are burned from that file and no additional filter is applied

### Requirement: Output location and overwrite

Mux SHALL write to `--out <file>` when given, else `<package base>/master/master.mp4`, creating the parent directory. It SHALL refuse to overwrite an existing output unless `--force` is set. A failed run SHALL leave no file at the output path.

#### Scenario: Default output

- **WHEN** mux succeeds without `--out`
- **THEN** `video_production/master/master.mp4` exists

#### Scenario: Burned output lands at the requested path

- **WHEN** mux succeeds with `--burn --out renders/final.mp4`
- **THEN** `renders/final.mp4` exists relative to the invoking cwd and no mp4 is left in any temp dir

#### Scenario: Existing output without force

- **WHEN** the output file exists and `--force` is not set
- **THEN** mux fails with `output exists — pass --force to overwrite`

#### Scenario: ffmpeg failure leaves no partial output

- **WHEN** ffmpeg exits non-zero
- **THEN** no file exists at the output path and mux fails reporting the last 10 lines of ffmpeg's stderr

### Requirement: No shell interpolation

Mux SHALL never pass sidecar-supplied paths through a shell.

#### Scenario: Path with shell metacharacters

- **WHEN** a sidecar path contains `$(`, `;` or spaces and resolves inside the package
- **THEN** mux uses the file literally and no shell command runs
