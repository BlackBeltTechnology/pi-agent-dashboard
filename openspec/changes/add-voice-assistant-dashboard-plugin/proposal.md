## Why

`set-copilot` (github.com/tatargabor/set-copilot) provides real-time voice dictation and a meeting copilot. Its capture/STT/transcript/knowledge engine is reusable; only the "intelligence" half is Claude-Code-specific (`.claude/skills/*` shelling `set-copilot` CLI subcommands and the Claude Code session reading stdout). pi-dashboard already ships the substitute: `ServerPluginContext.sendToSession(sessionId, text)` pushes text into a running pi session and `ctx.onEvent` streams what it says back. One server-side plugin can own capture + STT + knowledge cross-reference and drive dictation/meeting-copilot for any targeted pi session through those APIs.

**Revised 2026-10-03** against current `HEAD` and upstream `set-copilot@32b6a7d` (was `24a714d`). The recheck found the earlier "vendor the library surface and call it in-process" plan unbuildable: `runCapture()` calls `process.exit`, installs `SIGINT`/`SIGTERM` handlers, and reads config from `process.cwd()`; `runPoll()` returns `void` and writes batches to `process.stdout`; `loadConfig()` merges the project's `.env` into `process.env`. These were already true at `24a714d`. All vendored entrypoints therefore run in child processes. **Revised again 2026-10-04:** those children are owned by separately spawned pi sessions (a transcriber, and a copilot for meetings), not by the dashboard server. The live wall moved to its own package (`add-voice-wall-plugin`).

## What Changes

"Copilot" always means set-copilot's meeting-copilot **role**, played by a pi session; no Anthropic or Claude Code tooling is used. **Voice handling and agent control are pi-dashboard's own system.** set-copilot contributes vendored mechanics (realtime capture/STT, sentence building, fast lane, poll, stitch, policy rendering) and field lessons. Its Claude-Code control plane (skills, Monitor loop, forks, mirror-follow, Stop hooks) is replaced; see design § "Own-system mapping".

- New package `packages/voice-assistant-plugin`:
  - client and server entries; host-trusted; no bridge;
  - two pi extensions (**transcriber**, **copilot**), loaded only into the sessions it spawns;
  - vendors `set-copilot@32b6a7d` engine modules with one patch (`captureFactory`).
- **Transcription runs in a separately spawned transcriber pi session** (no tools, cheap model):
  - its extension owns the capture child and publishes `status.json`;
  - it stops on `/voice-stop`;
  - the dashboard server hosts no vendored or audio code.
- **Dictation** (chat composer mic): a short-lived transcriber per dictation, server mic by default or opt-in browser mic over the `"live"` scope. The stitched text is inserted into the composer draft (default) or sent (setting `dictation.delivery`), then the transcriber ends. Modes toggle/hold/auto, shortcut `Ctrl+M`, `Esc` cancels and restores the draft.
- **Meetings** (folder row) = **copilot session + meeting transcriber**, both fresh per meeting and owner-stamped:
  - start order: preflight → policy → copilot spawn → priming/pre-read → transcriber → wall;
  - the copilot extension runs its own poll child and feeds batches into its own session (follow-up when idle, steering for spoken commands);
  - it injects the policy every turn and provides `wall_emit`, `meeting_transcript` and `copilot_alert`;
  - drawings are done with **our subagents**;
  - a deny-first tool guard with a `meeting` preset; `bash` only through an unconfined opt-in;
  - mirror off by default; wall input gated.
- **Archive with our speaker naming:** the transcriber stitches the transcript, then diarizes the tee'd system audio with `video-transcription` (Soniox async) and names speakers with `pi-voiceid`. It writes `docs/meetings/<date>-<slug>.md`. The copilot writes notes, and kb-plugin reindexes. The next meeting's priming lists earlier meetings. The audio is deleted unless `keepAudio` is set.
- **Model selection:** copilot and transcriber models picked with `ui:model-selector` — global defaults in Settings › Plugins › Voice assistant, optional per-folder override in Folder settings › Plugins › Voice assistant (stored in plugin config, not the project file).
- **Project config in folder settings:** the `set-copilot.config.json` editor moves to the folder section (no folder selector).
- STT key from `video-transcription`'s configuration (shared with `pi-transcribe`), with an optional `ctx.credentials` override.
- Owner gating, host-wide device guard, activation orphan reap.
- Core seam: `composer-toolbar-action` slot — plugin controls in the composer input row before send/stop, with a bounded draft handle (`insertAtCursor`/`snapshot`/`restore`/`submit`).
- Core seam: `folder-settings-section` slot — plugins contribute per-folder settings pages at `/folder/<cwd>/settings/plugins/<pluginId>` (relaxes settings-panel's "folder settings host no plugin pages").

## Capabilities

### New Capabilities
- `voice-assistant-plugin-scaffold`: package, trusted manifest, two extensions, vendored surface, `video-transcription` dependency.
- `voice-assistant-transcriber-session`: spawned transcriber, capture child ownership, `status.json`, `/voice-stop`, key source, runtime dirs, time limit, device guard, reap, reconnect.
- `voice-assistant-dictation-control`: dictation through a short-lived transcriber, mic-live state, browser mic, owner gating.
- `voice-assistant-copilot-control`: meeting = transcriber + copilot, start/stop sequence, self-polled batches, backpressure, mirror/wall-input, disclosure.
- `voice-assistant-copilot-session`: fresh copilot, extension, policy injection, tools, our subagents for drawings, preset + guard, pre-read, notes.
- `voice-assistant-meeting-archive`: stitched archive, our diarization and speaker naming, audio retention, notes, kb coverage and reindex, prior meetings.
- `voice-assistant-knowledge-backend`, `voice-assistant-knowledge-browser`, `voice-assistant-config-editor`.
- Live wall: the wall plugin embeds its app as a folder page `/folder/<cwd>/wall` (folder entry + menu items, content area, via `add-plugin-app-host`); voice-assistant only links to it from the copilot session header and the meeting toast (no core seam of its own; the earlier live-target bridge is dropped).
- `composer-toolbar-actions`: core `composer-toolbar-action` slot, bounded composer handle, never-displaced placement.
- `folder-settings-plugin-sections`: core `folder-settings-section` slot, folder-settings Plugins nav group, per-plugin error isolation.

### Removed from this change
- `voice-assistant-meeting-wall` → `add-voice-wall-plugin`.
- `voice-assistant-capture-runtime` → superseded by `voice-assistant-transcriber-session` (server-owned runners dropped).

### Modified Capabilities
- `settings-panel`: the folder-scoped settings route accepts `plugins/<pluginId>` for plugins claiming `folder-settings-section` (was: never hosts plugin pages).

## References

Field material from Tatár Gábor (ITLine), kept verbatim in `references/` (see `references/README.md`):
- `2026-10-03-set-copilot-playbook.md`: how set-copilot ran on a real client call (config, instructions, knowledge layout, 14 lessons).
- `2026-10-03-set-copilot-architecture.html`: the signal-path architecture with 15 figures (capture, STT, sentence building, fast lane, poll, forks, wall, mirror, dictation, stitch).

These describe upstream behaviour. Where they assume Claude Code, our own system takes over (design § "Own-system mapping").

## Dependencies

- **`add-voice-wall-plugin`** — optional at runtime (wall features hidden, `wall_emit` refuses), but a **build-time** dependency: the copilot extension imports its `./emit` subpath. Land it first.
- **`add-plugin-app-host`** — optional: the embedded wall page (`/folder/<cwd>/wall`); without it the link opens the wall standalone.
- **kb-plugin** routes (`GET/PUT /api/kb/config`, `POST /api/kb/reindex`) — existing; used via `ctx.fastify.inject`.

## Discipline Skills

- **`security-hardening`** — spoken prompt injection into a tool-capable copilot session (preset + guard), meeting PII archived into the project tree and kb, microphone/system-audio capture, STT credential (now in `ctx.credentials`, injected into children via env), unredacted transcripts persisted in the target session's JSONL, wall-input lines forwarded into a tool-capable session, browser audio ingest through `/live/*`.
- **`performance-optimization`** — the server-side batch reader + backpressure path; host-stability (no event-loop starvation) is tested, latency budgets deferred.
- **`observability-instrumentation`** — children, STT reconnect state, ingest endpoint, new REST routes.
- **`node-inspect-debugger`** — child stdio protocol and WS ingest frames are opaque runtime state.
- **`doubt-driven-review`** — applied in planning and in this revision (child-process pivot, wall split); re-apply on the `runCapture` source-seam carve-out before it lands.
- **`review-code`** — before commit. **`systematic-debugging`**, **`code-simplification`** conditionally.

## Impact

- New package `packages/voice-assistant-plugin/` (client + server + transcriber/copilot pi extensions). Depends on `packages/video-transcription` (key resolution, Soniox async diarization, `pi-voiceid`); speaker naming needs ffmpeg and the speaker-embedding model that package already resolves. Must be host-trusted (`priority <= 100`) to spawn copilot sessions.
- Writes archived meetings into the project (`docs/meetings/` by default) and triggers kb-plugin reindex via its routes; may add the archive dir to the folder's kb sources with user consent. `pnpm-workspace.yaml` already globs `packages/*`; apply `add-new-plugin-package-checklist` instead.
- **Core changes:** the `composer-toolbar-action` and `folder-settings-section` slots (D21, D22). Wall embedding comes from `add-plugin-app-host` (dependency), not from this change.
- `/live/*` is now inside the universal network guard (`add-universal-network-guard`), so the browser-mic ingest path gets `/api`-equivalent network policy for HTTP and the existing ticket gate for the WS upgrade. Plugin WS routes (`ctx.registerWsRoute`) were considered and rejected for ingest: they are genuinely-local only, which defeats remote dictation.
- Requires an STT backend (Soniox key or local whisper) and, for server-local capture, `sox`/`parec` on the dashboard host. Browser-mic needs a secure context.
- Rollback: disable/remove the package; children are reaped, no persisted state besides `ctx.credentials` entries and scratch dirs under `~/.pi/dashboard/voice/`. Without `add-plugin-app-host`, the Live wall link falls back to the wall's standalone URL `/apps/wall/…`.
