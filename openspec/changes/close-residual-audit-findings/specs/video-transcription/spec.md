## ADDED Requirements

### Requirement: Extracted audio size limit enforced before upload

The tool SHALL enforce the audio size limit (`MAX_AUDIO_MB`, config `maxAudioMb`) on the extracted audio (total size), after extraction and before any upload or transcription request. Audio exceeding the limit SHALL fail with an error naming both the limit and the size found, and nothing SHALL be uploaded. A limit of `0` SHALL disable the check. 1 MB SHALL mean 1024² bytes. An invalid limit SHALL fall back to 200 with a warning. The error shows both sizes in MB with one decimal.

#### Scenario: Oversized audio is refused with sizes named

- **GIVEN** `MAX_AUDIO_MB` is 200 and an input whose extracted audio is 350 MB
- **WHEN** transcription is requested
- **THEN** the tool SHALL fail with an error naming `200.0` MB and `350.0` MB
- **AND** SHALL NOT call any API upload or transcription

#### Scenario: Audio within the limit proceeds

- **GIVEN** `MAX_AUDIO_MB` is 200 and audio of 150 MB
- **WHEN** transcription is requested
- **THEN** the tool SHALL proceed as usual

#### Scenario: Limit comes from configuration

- **WHEN** `MAX_AUDIO_MB` is set to `50` in the environment
- **THEN** a 60 MB audio SHALL be refused

#### Scenario: Megabyte is 1024 squared bytes
- **GIVEN** `MAX_AUDIO_MB` is `1`
- **WHEN** the extracted audio is 1048577 bytes
- **THEN** the tool SHALL refuse it, and SHALL accept audio of exactly 1048576 bytes

#### Scenario: Invalid limit falls back to 200
- **WHEN** `MAX_AUDIO_MB` is `abc` or `-5`
- **THEN** the limit SHALL be 200 MB and one warning SHALL be logged

#### Scenario: Zero disables the limit

- **GIVEN** `MAX_AUDIO_MB` is `0`
- **WHEN** transcription is requested for a 350 MB audio
- **THEN** the tool SHALL NOT refuse it for size

### Requirement: Media paths are absolute and never parsed as options

Every media path the tool passes to `ffmpeg` or `ffprobe` (inputs, outputs including the audio-decode output, chunk files, discovered files) SHALL be resolved to an absolute path against the spawn working directory at every spawn site, so that it is treated as a path and never as an option, even when its name begins with `-`.

#### Scenario: Dash-leading relative file name

- **GIVEN** an input file named `-i.mp4` in the working directory
- **WHEN** the tool probes and extracts it
- **THEN** ffprobe and ffmpeg SHALL receive its absolute path, open that file, and SHALL NOT interpret the name as a flag

#### Scenario: Dash-leading output path

- **WHEN** a derived output or chunk path would begin with `-`
- **THEN** it SHALL be passed as an absolute path, written there, and SHALL NOT be parsed as an ffmpeg option

#### Scenario: Discovered file in a relative directory

- **GIVEN** a relative input directory containing a file whose name begins with `-`
- **WHEN** the tool discovers and processes it
- **THEN** the path handed to ffmpeg or ffprobe SHALL be absolute

#### Scenario: Audio decode output path

- **GIVEN** an audio decode whose relative output path begins with `-`
- **WHEN** the tool decodes audio, or verifies a voice sample, with ffmpeg or ffprobe
- **THEN** every path argument, including the decode output, SHALL be absolute and SHALL NOT be parsed as an option

#### Scenario: Ordinary paths are unaffected

- **WHEN** the input path is already absolute
- **THEN** processing SHALL behave as before
