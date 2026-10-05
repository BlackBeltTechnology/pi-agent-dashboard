## ADDED Requirements

### Requirement: Stopped meetings are archived as stitched markdown
On `/voice-stop` of a non-dry-run meeting the transcriber session SHALL write the stitched transcript (sentences with turn numbers, never raw transcript JSONL) to `<projectRoot>/<archiveDir>/<YYYY-MM-DD>-<slug>.md` (default `docs/meetings`), with frontmatter `title`, `date`, `category: meeting`, `tags`, `speakers`, `meetingId`, `copilotSessionId`. Raw JSONL SHALL remain only in the scratch runtime dir.

#### Scenario: Archive written
- **WHEN** a meeting is stopped
- **THEN** one stitched `.md` with the required frontmatter exists under the archive dir and no `.jsonl` was copied there

#### Scenario: Name collision
- **WHEN** a file with the same date and slug exists
- **THEN** a numeric suffix is added and the existing file is not overwritten

### Requirement: Speakers are named with our own voice tools
Before writing the archive, the transcriber SHALL diarize the recorded system-channel audio with `video-transcription`'s async client and name clusters with `pi-voiceid label` against the local voiceprint library, assign names to `system` lines by time overlap, and label `mic` lines with the configured operator name or a voiceprint match. Unmatched clusters SHALL stay `[Speaker n]`; machine-assigned names SHALL be marked in frontmatter. The step SHALL be skipped with a note when disabled, keyless, or the library is empty, and SHALL never block the archive.

#### Scenario: Known voices
- **WHEN** two remote participants are enrolled in the voiceprint library
- **THEN** their lines in the archive carry their names and frontmatter lists them as machine-assigned

#### Scenario: Unknown voice
- **WHEN** a remote speaker is not enrolled
- **THEN** their lines keep an anonymous `[Speaker n]` label

#### Scenario: Naming fails
- **WHEN** diarization or labelling errors
- **THEN** the archive is written with channel labels and a note, and the meeting completes

### Requirement: Recorded audio is scratch by default
The meeting audio tee SHALL write only to the runtime dir and SHALL be deleted after the archive step unless `keepAudio` is enabled.

#### Scenario: Default retention
- **WHEN** a meeting is archived with `keepAudio` off
- **THEN** no audio file remains in the runtime dir or the project

### Requirement: Copilot writes meeting notes
After archiving, the system SHALL ask the copilot session to write `<same-name>-notes.md` (takeaways, decisions and action items, open questions, what was not discussed, citing turn numbers), permitting `write` only to that exact path for that turn, and SHALL then end the session gracefully. Failure to produce notes SHALL NOT block the archive or reindex.

#### Scenario: Notes written
- **WHEN** the notes turn completes
- **THEN** the notes file exists next to the transcript and the copilot session has ended

#### Scenario: Write elsewhere refused
- **WHEN** during the notes turn the copilot tries to write any other path
- **THEN** the guard blocks it

### Requirement: Archived meetings are indexed in the folder's kb
The system SHALL trigger the folder's kb reindex through kb-plugin's own reindex route after archiving, SHALL check at preflight whether the archive dir is covered by the folder's kb sources, and SHALL offer to add it when not.

#### Scenario: Reindex after stop
- **WHEN** a meeting is archived in a folder with a kb
- **THEN** a reindex is requested once through the kb-plugin route and the meeting becomes searchable with `category = meeting`

#### Scenario: Archive dir not covered
- **WHEN** preflight finds the archive dir outside the folder's kb sources
- **THEN** the start dialog offers to add it, and declining still allows the meeting with a warning that it will not be found by future meetings

#### Scenario: No kb in folder
- **WHEN** the folder has no kb
- **THEN** the archive is still written and preflight warns to include it in `knowledge.sources`

### Requirement: Prior meetings seed the next meeting
At meeting start the system SHALL list the most recent archived meetings of the folder (default 3, newest first) in the priming message.

#### Scenario: Continuity
- **WHEN** a folder has five archived meetings and a new meeting starts
- **THEN** the priming message lists the three newest transcript and notes files

### Requirement: Archive location is disclosed
The start confirmation SHALL show the archive path and state that the transcript of all parties will be stored in the project and indexed; the plugin SHALL never commit or push archive files.

#### Scenario: Disclosure
- **WHEN** the user opens the start dialog
- **THEN** it shows the resolved archive path and the indexing notice
