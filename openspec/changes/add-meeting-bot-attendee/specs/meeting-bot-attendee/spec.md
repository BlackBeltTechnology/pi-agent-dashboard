## ADDED Requirements

### Requirement: Bot joins a meeting only on operator confirmation and leaves with its meeting
The system SHALL join a Google Meet URL as a bot attendee only after the operator confirms. It SHALL use a browser profile reserved for the bot. It SHALL leave the call when:
- the operator stops it;
- the call ends;
- the bot is removed by the host;
- the transcriber it feeds ends.

Every failure SHALL be reported with the stage that failed: `launch`, `join`, `admit`, `camera`, `audio` or `ingest`.

#### Scenario: Confirmed join
- **WHEN** the operator starts the bot for a meeting URL and confirms
- **THEN** the bot joins the call and reports `joined`

#### Scenario: Not admitted
- **WHEN** the host does not admit the bot within the admit timeout
- **THEN** the bot gives up, closes its page and reports a failure at stage `admit`

#### Scenario: Transcriber ends
- **WHEN** the transcriber the bot feeds ends
- **THEN** the bot leaves the call

### Requirement: Bot discloses that it records
The bot's display name SHALL state that it records (for example `pi copilot (recording)`). The operator SHALL NOT be able to set a name without the recording marker.

#### Scenario: Name carries the marker
- **WHEN** the operator sets the bot name to `Notes`
- **THEN** the bot joins as `Notes (recording)`

### Requirement: Video out is the OBS Virtual Camera only
The bot SHALL use `OBS Virtual Camera` as its only video source and SHALL NOT screen-share or compose video itself. When the virtual camera is not available, the bot SHALL join with its camera off and report stage `camera`, rather than fall back to another camera.

#### Scenario: Virtual camera active
- **WHEN** the OBS Virtual Camera is running and the bot joins
- **THEN** attendees see the current OBS program output as the bot's camera

#### Scenario: No silent fallback to the host webcam
- **WHEN** the OBS Virtual Camera is not running and the bot joins
- **THEN** the bot's camera is off and no other camera device is opened

### Requirement: Broadcast Wall scenes load the Wall as a viewer
A Wall scene created for the bot's output SHALL load the Wall through its share-link (viewer) URL and SHALL NOT load an operator-class Wall URL.

#### Scenario: Private-zone event not broadcast
- **WHEN** a producer emits a Wall event with `zone: "private"` while the Wall scene is on the virtual camera
- **THEN** the event does not appear in the bot's video

### Requirement: Audio in is remote meeting audio, fed as the non-operator channel
The bot SHALL capture only the call's remote audio tracks, with no bot microphone and no local playback. It SHALL stream that audio to the meeting transcriber's ingest endpoint as the non-`mic` channel. Speech arriving through the bot SHALL NOT be treated as an operator voice command.

#### Scenario: Remote speech transcribed
- **WHEN** a participant speaks in the call
- **THEN** the transcriber receives their audio through the bot and transcribes it

#### Scenario: Spoken command through the bot is not obeyed
- **WHEN** a participant says a copilot command in the call
- **THEN** the copilot does not act on it as a command

#### Scenario: Meeting page opens no connection to the dashboard
- **WHEN** the bot streams meeting audio
- **THEN** the audio reaches the ingest through the bot driver over a capability path (`/live/<id>/~c/<token>/audio-ingest`), and the meeting page itself opens no connection to the dashboard

#### Scenario: Capability renewed in a long meeting
- **WHEN** the ingest capability approaches its `expiresAt` during a meeting
- **THEN** the driver mints a fresh capability and the transcriber keeps receiving audio without the meeting stopping

#### Scenario: No echo
- **WHEN** the bot is in the call on the dashboard host
- **THEN** the call's audio is not played through the host's speakers by the bot
