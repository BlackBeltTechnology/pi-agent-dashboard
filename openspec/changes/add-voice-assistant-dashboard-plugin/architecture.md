# Architecture — voice assistant + voice wall (rev. 2026-10-04)

"Copilot" = set-copilot's meeting-copilot **role**, played by a pi session. Voice handling and agent control are **pi-dashboard's own system**. set-copilot contributes vendored mechanics and field lessons (`references/`).

## 1. Components

```mermaid
flowchart TB
  subgraph BROWSER["Browser (dashboard client)"]
    CARD["Composer mic<br/>dict-start / dict-end"]
    FOLDER["Folder row<br/>Start meeting · Dry run · Stop<br/>Open copilot · Open transcriber · View wall"]
    KBV["Knowledge overlay<br/>sources · decisions · meetings"]
    SET["Settings<br/>config · key source · voiceprints"]
    WORKLET["AudioWorklet (browser mic)"]
    APPF["Wall page /folder/:cwd/wall<br/>content area (wall plugin, add-plugin-app-host)"]
  end

  subgraph SERVER["Dashboard server (coordinator only)"]
    VA["voice-assistant server entry<br/>routes · owner gate · device guard<br/>spawn / '/voice-stop' / abort<br/>status.json watcher · kb reindex"]
    VW["voice-wall plugin<br/>ensureWall · input gate"]
    KBP["kb-plugin routes"]
    LIVE["/live/:id/* proxy (guarded)"]
    PROMPT["prompt runner → policy.md"]
  end

  subgraph TS["Transcriber pi session (noTools, cheap model)"]
    TEXT["transcriber extension<br/>/voice-stop · status.json"]
    CAP["capture child<br/>runCapture (Soniox realtime)<br/>+ ingest ws · + WAV tee"]
    ARCH["archive pipeline<br/>stitchFile → our Soniox async diarization<br/>→ pi-voiceid label → docs/meetings/*.md"]
  end

  subgraph CS["Copilot pi session (meeting preset + guard)"]
    CEXT["copilot extension<br/>policy injection · tools · guard<br/>mirror (opt-in) · pre-read"]
    POLL["poll child<br/>runPoll → JSONL batches"]
    SUB["our subagents<br/>(drawings)"]
  end

  subgraph TARGET["User's pi session"]
    USR["dictation target"]
  end

  subgraph DISK["Files (the only data boundary)"]
    SCR[("~/.pi/dashboard/voice/&lt;hash&gt;/<br/>transcript.jsonl · wall-events.jsonl<br/>status.json · handover.json · policy.md · *.wav")]
    PROJ[("project docs/meetings/*.md")]
    KBDB[("kb index")]
  end

  CARD & FOLDER & KBV & SET --> VA
  VA -->|spawnSession + transcriber ext| TEXT
  VA -->|spawnSession + copilot ext| CEXT
  VA --> PROMPT --> SCR
  TEXT --> CAP --> SCR
  TEXT --> ARCH --> PROJ
  CEXT --> POLL
  POLL -->|reads| SCR
  POLL -->|batches: followUp / steer| CEXT
  CEXT --> SUB
  CEXT -->|wall_emit| SCR
  VW -->|wall child tails| SCR
  TEXT & CEXT -->|status.json| SCR
  SCR -. "fs.watch" .-> VA
  VA -->|sendToSession dictated text| USR
  VA -->|reindex via inject| KBP --> KBDB
  CEXT -->|kb_search| KBDB
  WORKLET -->|PCM| LIVE --> CAP
  APPF --> VW
```

## 2. Meeting lifecycle

```mermaid
sequenceDiagram
  autonumber
  actor U as Operator
  participant VA as Server (coordinator)
  participant C as Copilot session
  participant T as Transcriber session
  participant W as voice-wall
  participant K as kb-plugin

  U->>VA: Start meeting (disclosure, owner-gated)
  VA->>VA: preflight · device guard · prompt runner → policy.md
  VA->>C: spawnSession(copilot ext, meeting preset, nonce)
  VA->>C: priming: pre-read list + newest meetings
  C-->>VA: status.json ready ("Pre-read: n/total") or 120 s timeout
  VA->>T: spawnSession(transcriber ext, noTools, nonce)
  T->>T: capture child (mic + system, WAV tee)
  VA->>W: ensureWall
  VA->>C: /voice-transcriber-live → start poll child
  loop poll windows
    C->>C: batch → followUp (idle) / pending / steer (command)
    C->>W: wall_emit (directly or via subagent)
    C-->>U: private alerts · copilot_alert notifications
  end
  U->>VA: Stop
  VA->>T: /voice-stop
  T->>T: stop capture → stitch → our diarization + pi-voiceid → docs/meetings/*.md → delete WAV
  T-->>VA: status archived
  VA->>C: /voice-meeting-ended → stop poll → notes turn (-notes.md)
  VA->>C: abort (graceful)
  VA->>T: abort (graceful)
  VA->>W: stopWall
  VA->>K: POST /api/kb/reindex
```

## 3. Dictation

```mermaid
sequenceDiagram
  actor U
  participant VA as Server
  participant T as Transcriber session (short-lived)
  participant S as User's pi session
  U->>VA: dict-start (server | browser)
  VA->>T: spawnSession(transcriber ext, mode=dictation)
  T-->>VA: status.json live (badge: starting mic → recording, tone)
  opt browser source
    T-->>VA: ingest port → live row → /live/<id>/audio-ingest
  end
  U->>VA: dict-end
  VA->>T: /voice-stop
  T-->>VA: handover.json {text, raw}
  VA->>S: sendToSession(text || raw)
  VA->>T: abort (graceful)
```

## 4. Trust boundaries

```mermaid
flowchart LR
  subgraph UNTRUSTED["Untrusted"]
    SPEECH["Other party's speech"]
    WIN["Wall keyboard input"]
    AUDIO["Browser audio frames"]
  end
  subgraph GATES["Gates"]
    G1["Copilot preset + deny-first guard<br/>(incl. subagents) · mic-only commands"]
    G2["Wall input allow-list"]
    G3["Ingest validation · universal guard · WS ticket"]
    G4["Owner gating"]
    G5["Transcriber noTools · env allowlist<br/>key via extensionConfig only"]
  end
  subgraph ASSETS["Assets"]
    PROJ["Project files"]
    SESS["pi sessions"]
    KEY["STT key"]
    PII["Transcripts · audio (scratch, deleted) · archive in kb"]
  end
  SPEECH --> G1 --> PROJ
  WIN --> G2 --> SESS
  AUDIO --> G3 --> SESS
  G4 --> SESS
  G5 --> KEY
  PII -. disclosed; dry run not archived; keepAudio opt-in .- G4
```

## 5. Own-system mapping (summary)

| Upstream (Claude Code) | Ours |
|---|---|
| `/ds` `/dd` | Composer mic (`composer-toolbar-action`) → short-lived transcriber session → draft |
| `/meeting-copilot` + Monitor loop | Folder row → copilot session with its own poll child |
| `capture --detach` | Capture child owned by the transcriber extension |
| `fork` producers | Our subagents + `wall_emit` |
| `mirror-follow` | Copilot extension `message_end` (opt-in) |
| `transcript` stitch | Transcriber archive + our Soniox async diarization + `pi-voiceid` |
| Desktop notify | `copilot_alert` → `ctx.ui.notify` |

## 6. Package map

| Package | Owns |
|---|---|
| `packages/voice-assistant-plugin` | coordinator server, client surfaces, transcriber + copilot extensions, runners, vendored engine |
| `packages/voice-wall-plugin` | wall children, `/live` registration, input gate, `./emit` |
| `packages/video-transcription` (existing) | STT key resolution, Soniox/AssemblyAI async, `pi-voiceid` speaker naming |
| `packages/kb-plugin` (existing) | kb config + reindex |
| `packages/client` (via `add-plugin-app-host`) | embedded wall app frame |
