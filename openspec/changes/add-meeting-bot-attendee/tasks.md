## 0. Spike (gate — nothing below starts before 0.7)

- [ ] 0.1 S0 (no code): OBS scenes (Wall share URL, desktop region, composite) → Virtual Camera in the operator's own Meet; compare with presenting an OBS windowed projector; record legibility on a second device (design D1/Q1)
- [ ] 0.2 S1: `/tmp` Playwright script, `channel: "chrome"`, headed, persistent bot profile, `--use-fake-ui-for-media-stream`; join a test Meet with the OBS Virtual Camera; 3 joins out of 3; record automation-block and admit behaviour; record which camera the fake-UI flag picks by default and which explicit selection works (Meet settings / Chrome pref / `deviceId` constraint) (design D6)
- [ ] 0.3 S2: `addInitScript` RTCPeerConnection ontrack tap → AudioWorklet 16 kHz PCM → `exposeBinding` to the Node driver → dummy WS → WAV (the page opens no network connection; design D3). Record intelligibility, latency, track count and track-to-speaker mapping. Confirm that a WS from the Meet page to localhost is blocked (CSP / local-network access) to justify D3. If `improve-canvas-html-and-url-ux` has landed, also stream to a real `/live/<id>/~c/<token>/` target and record whether an open WS survives token expiry
- [ ] 0.4 S3: switch scenes mid-call with `pi-obs` via `service exec`; record latency to Meet
- [ ] 0.5 S4 (optional): chat DOM scrape; record the visible sender identity
- [ ] 0.6 Write `spike-findings.md` (F-numbered, MEASURED / NOT MEASURED) and run `doubt-driven-review` on go/no-go and the profile choice (D6/Q2)
- [ ] 0.7 Revise proposal, design, spec and the tasks below against the findings. No-go on S1/S2 → re-propose with option 2 (managed vendor)

## 1. Dependencies (amend other changes)

- [ ] 1.1 `add-voice-wall-plugin`: add "share token forces viewer class" (loopback + token) to `voice-wall-access` (design D2)
- [ ] 1.2 `add-voice-assistant-dashboard-plugin`: allow a meeting transcriber to take the ingest source, mapped to the non-`mic` channel (design D3/D4). Its ingest capability-path coordination task (from `improve-canvas-html-and-url-ux`) is a prerequisite

## 2. Implementation (provisional — revised in 0.7)

- [ ] 2.1 Scaffold `packages/meeting-bot-plugin` per `add-new-plugin-package-checklist`
- [ ] 2.2 Meet page driver: join, disclosure name, camera = OBS Virtual Camera, leave, staged failure reporting
- [ ] 2.3 Injected audio tap (under `src/driver/`, outside client roots) + `exposeBinding` hand-off + Node ingest client: capability mint, `~c/<token>` path, re-mint before `expiresAt`, format check, reconnect, stop with the transcriber
- [ ] 2.3a Explicit OBS Virtual Camera selection per the S1 finding; never the default camera
- [ ] 2.4 OBS "Wall broadcast" scene preset using the Wall share-link URL (via `pi-obs`)
- [ ] 2.5 Start/stop route + operator confirmation + lifecycle hooks (meeting end, transcriber end)
- [ ] 2.6 `server.log` instrumentation for join/admit/leave/fail, ingest stream and camera state
- [ ] 2.7 Tests for every spec scenario; `review-code`; docs via DocScribe
