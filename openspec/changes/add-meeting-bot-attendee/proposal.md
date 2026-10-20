## Why

The meeting copilot (`add-voice-assistant-dashboard-plugin`) hears a meeting only through the dashboard host's microphone and system-audio tee. The live Wall (`add-voice-wall-plugin`) reaches a call only when a human shares a window. A meeting where the operator is not on the dashboard host, or where the Wall should be a participant in its own right, is not covered.

Decided in explore: pi-dashboard joins the call **as a visible bot attendee**:
- **audio in** goes to the transcriber;
- **video out** is the operator's **OBS Virtual Camera**, so the operator chooses in OBS what the call sees: the Wall, a desktop region, or a composite;
- **chat in** is a later step.

The bot is a self-hosted browser driven by Playwright (option 1), not a managed meeting-bot vendor or the platform media SDKs. The reasons: audio stays local, the repo already has Playwright, the dedicated agent Chrome and the browser-mic ingest, and one approach can cover Meet and Teams web.

Feasibility is unproven (automation blocking, audio capture from WebRTC, camera-tile legibility), so **task 0 is a timeboxed spike that gates everything else**.

## What Changes

- **Task 0 spike (gate).** Stages S0–S4 in `design.md`. Results go to `spike-findings.md`. Requirements and tasks after task 0 are provisional and SHALL be revised against the findings before implementation.
- **Bot attendee (Google Meet first).**
  - Joins a meeting URL from a browser profile reserved for the bot, after operator confirmation.
  - Shows a fixed recording-disclosure display name.
  - Leaves on stop, on meeting end, or when its transcriber ends.
- **Video out = OBS Virtual Camera.** The bot never composes or screen-shares. Scenes are managed with the shipped `obs-studio` plugin (`pi-obs` verbs, presets). A "Wall" scene preset uses the Wall **share-link (viewer) URL**, never the loopback operator URL.
- **Audio in = remote WebRTC tracks only.**
  - No bot microphone and no local playback.
  - The audio is mixed to PCM in the page and handed to the bot's Node driver; the page itself opens no network connection.
  - The driver streams it to the transcriber's ingest through a minted live-server capability (`/live/<id>/~c/<token>/audio-ingest`, per `improve-canvas-html-and-url-ux` D10) as the meeting's remote channel.
- **No voice authority.** Bot audio is never treated as the operator `mic` channel, so spoken commands arriving through the bot are not acted on (typed-only, for v1).
- Out of scope (v1): chat relay to Wall input, Teams web, per-speaker identity from the platform, a managed-vendor `MeetingBotDriver`.

## Capabilities

### New Capabilities
- `meeting-bot-attendee`: bot join/leave lifecycle, disclosure naming, OBS Virtual Camera as the only video source, remote-audio capture into the transcriber ingest, no voice-command authority, and viewer-only Wall in broadcast scenes.

### Modified Capabilities
None. The capabilities this change relies on (`voice-assistant-*`, `voice-wall-*`) are not shipped yet, so any amendment to them goes into their own changes (see `design.md` § Dependencies).

## Discipline Skills

- `security-hardening`:
  - meeting audio from third parties enters a tool-capable copilot;
  - the bot's browser profile holds a Google account session;
  - broadcast output must never carry operator-only Wall content.
- `doubt-driven-review`: the spike's go/no-go and the choice of browser profile (reuse the dedicated agent profile or keep a separate bot profile) need review before they stand.
- `observability-instrumentation`: join, admit, leave and fail states, the audio-ingest stream and the camera-source state must be diagnosable from `server.log`.
- `review-code`: before commit.

## Impact

- New code (location decided after the spike): most likely `packages/meeting-bot-plugin/` (server route + Playwright driver + injected audio script). Follow `add-new-plugin-package-checklist`.
- Reuses: `dedicated-agent-browser` (CDP proxy, Chrome lifecycle), the `obs-studio` plugin (`pi-obs` virtual camera and scenes), the voice-assistant browser-mic ingest, and the live-server capability mint from `improve-canvas-html-and-url-ux`.
- Host requirements: OBS ≥ 28 installed in `/Applications` with the camera extension allowed; Chrome camera permission in macOS privacy settings. Chrome must be restarted after the virtual camera first activates (it caches its camera list; obs-studio spike finding).
- Rollback: disable the plugin. The bot leaves, and nothing persists except the bot browser profile.
