> **Revised 2026-10-04.**
> - Transcription runs in a separately spawned **transcriber** pi session.
> - Meetings add a **copilot** pi session that runs its own poll.
> - The server only coordinates.
> - Voice handling and agent control are our own system (`video-transcription`, `pi-voiceid`, subagents, pi sessions).
> - References: `references/`.
> - Land `add-voice-wall-plugin` first (`./emit`).

## 1. Scaffold

- [ ] 1.1 `dashboard-plugin-scaffold` (`new`):
  - id `voice-assistant`, server yes, bridge NO, configSchema;
  - host-trusted priority (`<= 100`);
  - slots `composer-toolbar-action`, `session-card-badge`, `session-card-action-bar`, `sidebar-folder-section`, `shell-overlay-route`, `settings-section`, `folder-settings-section`.
- [ ] 1.2 `extension/transcriber/` and `extension/copilot/` (no `pi` manifest key, so pi never loads them globally); runtime path resolution for `scope.extensions`.
- [ ] 1.3 Dependencies: `@blackbelt-technology/pi-dashboard-video-transcription`, `@blackbelt-technology/pi-dashboard-kb`, `@blackbelt-technology/pi-dashboard-voice-wall-plugin` (`./emit`), `ws`.
- [ ] 1.4 `add-new-plugin-package-checklist` registrations; `pnpm install`.
- [ ] 1.5 `NOTICE` + README: upstream pin `32b6a7d4116d184528107f33fd31f148177bf73e`, file list, exclusions, `capture-source.patch`, own-system mapping, scratch root, archive/PII/audio-retention notes, `references/`.

## 2. Vendor

- [ ] 2.1 `scripts/vendor-set-copilot.mjs` (closure, copy, patch, NOTICE; fail on excluded modules).
- [ ] 2.2 Run at pin; `tsc --noEmit` clean.
- [ ] 2.3 `capture-source.patch` (`captureFactory`); `doubt-driven-review` before sections 4 and 7 build on it.

## 3. Runners (`src/runner/*`)

- [ ] 3.1 `capture`: `runCapture({micOnly, maxMinutes, captureFactory})`.
- [ ] 3.2 `captureFactory` implementations:
  - (a) browser ingest `ws` (frame validation, port to stderr);
  - (b) per-channel WAV tee (meeting).
- [ ] 3.3 `handover`, `archive` (`stitchFile`), `prompt` (`policy.md`), `poll` (loop + sentinel).
- [ ] 3.4 Shared spawn helper: `detached`, env allowlist, `SET_COPILOT_DIR`, key, `error`/`exit` listeners, stderr ring.

## 4. Transcriber extension (D5–D7, D13)

- [ ] 4.1 Read `PI_EXT_VOICE_*`; inert without config.
- [ ] 4.2 On `session_start`, spawn capture; atomic `status.json` phases; reconnect parsing; play the live tone.
- [ ] 4.3 `/voice-stop`:
  - dictation → handover → `handover.json`;
  - meeting → archive pipeline (4.4).
- [ ] 4.4 Archive pipeline:
  1. stitch;
  2. our `SonioxClient` async diarization on the system WAV;
  3. `pi-voiceid label` (library via `PI_VOICEPRINT_STORE` default);
  4. overlap-based naming + `mic` operator name;
  5. write `docs/meetings/<date>-<slug>.md` with frontmatter (collision suffix);
  6. delete WAVs unless `keepAudio`;
  6a. copy the runtime dir's `wall-events.jsonl` (if any) next to the meeting note as `docs/meetings/<date>-<slug>.wall.jsonl` (read-only replay for the wall's empty state, D19);
  7. phase `archived`.

  Naming errors fall back to channel labels plus a note.
- [ ] 4.5 `/voice-status`; `session_shutdown` kills the capture group.

## 5. Copilot extension (D10–D12)

- [ ] 5.1 Read `PI_EXT_VOICE_*`; inert without config.
- [ ] 5.2 `before_agent_start`: additive policy section; bridge coexistence.
- [ ] 5.3 Poll child (started on server signal `/voice-transcriber-live` or when `status.json` shows the transcriber `live`):
  - parser;
  - follow-up when `ctx.isIdle()`, pending merge otherwise, flush on `agent_end`;
  - commands/name-addressed as `steer`;
  - `capture-dead` → error;
  - `wall-input` gating.
- [ ] 5.4 Tools: `wall_emit`, `meeting_transcript`, `copilot_alert`.
- [ ] 5.5 Mirror (opt-in) on `message_end`; filler list.
- [ ] 5.6 Pre-read detection → `status.json` `ready`.
- [ ] 5.7 Deny-first guard (preset name gate, project-root path gate, one-shot notes write from `notes-target.json`).
- [ ] 5.8 **Verify** that subagent tool calls hit the guard or are restricted to the preset; if not, drop `Agent` from `meeting` and record it in `NOTICE` (test-plan #51).
- [ ] 5.9 `/voice-meeting-ended`: stop poll, notes turn; `session_shutdown` kills the poll group.

## 6. Server coordinator (D4, D6, D8, D11, D14–D16)

- [ ] 6.1 State: dictation pairs, folder meetings; `fs.watch` on runtime dirs → status, with an `onEvent` backstop.
- [ ] 6.2 Key resolution via `video-transcription` `loadConfig` plus `ctx.credentials` override.
- [ ] 6.3 Device guard; owner gating; preflight route (config version, key, tooling, knowledge, kb coverage, ffmpeg + speaker model for naming, resolved copilot/transcriber model in registry).
- [ ] 6.3a `resolveRoleModel(cwd, role)`: folder override → global default → pi default; used by every transcriber/copilot spawn (D20).
- [ ] 6.4 Dictation:
  - spawn transcriber (nonce, 30 s);
  - `dict-end` → `/voice-stop` → read `handover.json` → return `{runId, text}` to the client (fail-open);
  - no live composer: retain by `{targetSessionId, runId}`; delivery `send` fallback `sendToSession` (false → retain);
  - cancel → discard;
  - graceful abort.
- [ ] 6.5 Browser ingest registration via `ctx.fastify.inject`; delete on end.
- [ ] 6.6 Meeting start:
  1. `prompt` runner;
  2. spawn copilot;
  3. priming (prior meetings from kb);
  4. wait for `ready` or 120 s;
  5. spawn transcriber;
  6. `ensureWall`;
  7. signal the copilot to start polling.
- [ ] 6.7 Meeting stop:
  1. `/voice-stop` → wait for `archived`;
  2. `/voice-meeting-ended` → wait for the notes turn end (timeout);
  3. abort both;
  4. `stopWall`;
  5. `POST /api/kb/reindex`.

  Dry run skips archive, notes and reindex.
- [ ] 6.8 Teardown on `onSessionEnded` (target or meeting sessions), `onShutdown`, disable; activation reap.
- [ ] 6.9 kb coverage offer (`PUT /api/kb/config`); config + credential routes (`networkGuard`, `isAllowedCwd`, containment, `config-migrate`).

## 7. Browser-mic client

- [ ] 7.1 Source picker (hidden when insecure), `AudioWorklet` PCM, live-scope ticket, failure states, teardown.

## 8. Client

- [ ] 8.1 Composer mic (`composer-toolbar-action`, D22): states idle / `starting mic` / `recording` (+ level for browser) / `processing` / error+Retry; source menu (server host named, browser hidden when insecure); `insertAtCursor` or insert+`submit` per `dictation.delivery`; `Esc` cancel → `restore`; modes toggle/hold/auto + `Ctrl+M`; retained-text offer (Insert / Copy / Discard) on mount.
- [ ] 8.2 Folder row: Start meeting / Dry run / Stop / Open copilot / Open transcriber; phase badge. (Live wall entry + menu items are the wall plugin's.)
- [ ] 8.3 Start dialog: disclosure (capture, audio tee + deletion, copilot session, archive path + indexing), mirror toggle, preset, `keepAudio`, kb coverage offer.
- [ ] 8.4 Role badge on spawned session cards (transcriber / copilot) + Stop.
- [ ] 8.5 "Live wall" links in the copilot session header and meeting toast → `/folder/<encodedCwd>/wall` (wall plugin page, `add-plugin-app-host`), fallback `/apps/wall/…`; hidden without `voiceWall` or a running wall (D19).
- [ ] 8.6 Knowledge overlay with archived meetings.
- [ ] 8.7 Global settings section: global copilot/transcriber model defaults (`ui:model-selector`, D20), link to folder settings, key source/status, voiceprint library status (count, store path) with a link to `pi-voiceid` enrollment docs.
- [ ] 8.7a Folder settings section (`folder-settings-section`, label "Voice assistant", D21): `set-copilot.config.json` editor for `cwd` (no folder selector) + per-folder model overrides with "inherit global (<ref>)".
- [ ] 8.8 `configSchema.json`:
  - `dictation.delivery` (`draft`|`send`, default `draft`), `dictation.minSendWords` (3), `dictation.mode` (`toggle`|`hold`|`auto`, default `toggle`), `dictation.shortcut` (`Ctrl+M`);
  - `transcriberModel`, `copilotModel` (global defaults), `folderModels` (per-cwd override map), `archiveDir`, `priorMeetings`;
  - `mirrorFiller[]`, backpressure cap, poll window, `maxMinutes`;
  - `keepAudio`, `speakerNaming`, `scriptsProjects[]`.

## 9. (removed) Core seam — live-target bridge

Superseded by `add-plugin-app-host` (D19). No tasks.

## 9c. Core seam — composer toolbar actions (D22)

- [ ] 9c.1 `composer-toolbar-action` slot id in `slot-types.ts`, props in `slot-props.ts`; `manifest-validator.ts` requires `ariaLabel`.
- [ ] 9c.2 `ComposerToolbarActionSlot` consumer + bounded `composer` handle (`insertAtCursor`, `snapshot`/`restore`, `submit` via the send path); inert after unmount/session switch.
- [ ] 9c.3 `CommandInput.tsx`: render the slot in the input-row trailing cluster before terminal + action button; never folded into `⋯`; never hidden by draft/attachments/working state.
- [ ] 9c.4 DOX rows (`CommandInput.tsx.AGENTS.md`, runtime/shared AGENTS); `docs/` slot list via DocScribe.

## 9b. Core seam — folder settings plugin sections (D21)

- [ ] 9b.1 `folder-settings-section` slot id in `slot-types.ts`, props `{ pluginContext, cwd }` in `slot-props.ts`; `manifest-validator.ts` requires `label`.
- [ ] 9b.2 `FolderSettingsSectionSlot` consumer in `slot-consumers.tsx` (error boundary; only route `cwd`).
- [ ] 9b.3 `DirectorySettings.tsx`: Plugins nav group (hidden with zero enabled claims), route `/folder/:cwd/settings/plugins/:pluginId`, invalid-page fallback for non-claiming/disabled plugins.
- [ ] 9b.4 Update `settings-panel` main spec on archive; DOX rows for touched files; `docs/plugin-ui-primitives.md`/architecture slot list via DocScribe.

## 10. Tests (folded from test-plan.md — manifest is the source of truth)

> L1 in `packages/voice-assistant-plugin/src/**/__tests__/` and `extension/**/__tests__/` (fake pi extension host, fake recorder/STT, fake diarizer/voiceid); L3 `tests/e2e/voice-assistant-*.spec.ts`; L2 `qa/tests/`.

- [ ] 10.1 [L1] test-plan #1: dict-start → transcriber spawned (noTools, transcriber ext, owner, nonce) → live → dict-end sends /voice-stop …
- [ ] 10.2 [L1] test-plan #2: dict-end without start · nothing spawned or sent
- [ ] 10.3 [L1] test-plan #3: handover.json with empty text, non-empty raw · raw sent
- [ ] 10.4 [L1] test-plan #4: sendToSession false · delivery-failed, text retained
- [ ] 10.5 [L1] test-plan #5: Silence-only dictation · nothing sent, transcriber ended
- [ ] 10.6 [L1] test-plan #6: Preflight {config version × key resolves × tooling × knowledge × kb covers archive × ffmpeg/model for naming} …
- [ ] 10.7 [L1] test-plan #7: Knowledge gate · neither blocked; kb or sources alone allowed
- [ ] 10.8 [L1] test-plan #8: Either meeting session ends unexpectedly · meeting stops, partial archive, other session ended
- [ ] 10.9 [L1] test-plan #9: onShutdown during meeting · both sessions aborted
- [ ] 10.10 [L1] test-plan #10: Second start for running folder meeting / dictation pair · idempotent
- [ ] 10.11 [L1] test-plan #11: Device guard: server dictation in A vs meeting in B · refused naming A; browser dictation exempt
- [ ] 10.12 [L1] test-plan #12: Copilot ext pending payload cap−1/cap/cap+1 · whole / whole / oldest dropped + marker
- [ ] 10.13 [L1] test-plan #13: Copilot ext: batch while idle → sendUserMessage(followUp); batch while busy → pending, flushed on agent_end as…
- [ ] 10.14 [L1] test-plan #14: {"type":"command"} / name-addressed line mid-turn · delivered as steer immediately
- [ ] 10.15 [L1] test-plan #15: Transcriber: reconnect lines then transcript · status.json reconnecting (n) → live; terminal error → error
- [ ] 10.16 [L1] test-plan #16: Capture child exits 1 · transcriber phase error with stderr tail; pi process survives
- [ ] 10.17 [L1] test-plan #17: Server module graph · no vendored capture/poll/handover/stitch-run, no loadConfig
- [ ] 10.18 [L1] test-plan #18: sox absent · transcriber error naming the tool
- [ ] 10.19 [L1] test-plan #19: Child env allowlist; dashboard env untouched; key only via extensionConfig; transcriber spawn has noTools
- [ ] 10.20 [L1] test-plan #20: Quiet batch · nothing delivered
- [ ] 10.21 [L1] test-plan #21: Delivered batch contains transcript lines only (policy not prepended)
- [ ] 10.22 [L1] test-plan #22: Redaction-matching line delivered unredacted to copilot
- [ ] 10.23 [L1] test-plan #23: Copilot ext poll parser: lines+sentinel / capture-dead / garbage / over-long / unknown
- [ ] 10.24 [L1] test-plan #24: Mirror {off,on} × {substantive final, filler, empty, delta, tool output} · only on+substantive final appended
- [ ] 10.25 [L1] test-plan #25: wall-input × {not allowed, allowed} · dropped+logged / [wall operator]: follow-up
- [ ] 10.26 [L1] test-plan #26: Zero kb queries per transcript line
- [ ] 10.27 [L1] test-plan #27: Backend selection kb / fallback / "kb unavailable"
- [ ] 10.28 [L1] test-plan #28: Both knowledge backends pass one suite
- [ ] 10.29 [L1] test-plan #29: Status-faceted decisions on kb; flat on fallback
- [ ] 10.30 [L1] test-plan #30: Config PUT path escape rejected
- [ ] 10.31 [L1] test-plan #31: Routes × {untrusted unauth, folder outside allow-list} rejected before I/O
- [ ] 10.32 [L1] test-plan #32: Key resolution: video-transcription config used; ctx.credentials override wins; GET reports source + set/unset…
- [ ] 10.33 [L1] test-plan #33: Old config migrated, unknown fields preserved
- [ ] 10.34 [L1] test-plan #34: Upstream hand-over hook commands never executed
- [ ] 10.35 [L1] test-plan #35: Bridge mount states
- [ ] 10.36 [L1] test-plan #36: Bridge provider stack with FolderEditorView
- [ ] 10.37 [L1] test-plan #37: Undecodable encodedCwd
- [ ] 10.38 [L1] test-plan #38: Ingest format mismatch rejected
- [ ] 10.39 [L1] test-plan #39: Ingest port in status.json → live row; transcriber end → row deleted
- [ ] 10.40 [L1] test-plan #40: Activation reap of live owners; runtime dir outside scratch refused
- [ ] 10.41 [L1] test-plan #41: Meeting start order: copilot spawned + primed before transcriber spawn; wall after
- [ ] 10.42 [L1] test-plan #42: Spawn timeout (either role) · abort, no children left
- [ ] 10.43 [L1] test-plan #43: Two meetings · different sessions and runtime dirs
- [ ] 10.44 [L1] test-plan #44: Pre-read line → ready; timeout → transcriber started, "unconfirmed"
- [ ] 10.45 [L1] test-plan #45: Policy additive on before_agent_start; bridge coexistence both orders
- [ ] 10.46 [L1] test-plan #46: Policy present after many turns
- [ ] 10.47 [L1] test-plan #47: wall_emit valid / invalid / no wall / array
- [ ] 10.48 [L1] test-plan #48: copilot_alert notify / non-notify
- [ ] 10.49 [L1] test-plan #49: meeting_transcript since turn N
- [ ] 10.50 [L1] test-plan #50: Guard × {in-preset, bash under meeting, foreign ext tool, MCP/codemode, path escape incl. symlink, bash under …
- [ ] 10.51 [L1] test-plan #51: Subagent started by copilot calls out-of-preset tool · blocked (else Agent removed from preset — recorded)
- [ ] 10.52 [L1] test-plan #52: Owner gating × {owner, other principal, local operator}
- [ ] 10.53 [L1] test-plan #53: Stop sequence: /voice-stop → archived → /voice-meeting-ended → notes → both ended → wall stopped → one reindex
- [ ] 10.54 [L1] test-plan #54: Dry run · no archive, notes, reindex
- [ ] 10.55 [L1] test-plan #55: Archive name collision suffix
- [ ] 10.56 [L1] test-plan #56: Notes turn one-shot write path only
- [ ] 10.57 [L1] test-plan #57: Notes failure does not block archive/reindex
- [ ] 10.58 [L1] test-plan #58: kb coverage {covered, offer→PUT /api/kb/config, no kb warn}
- [ ] 10.59 [L1] test-plan #59: Prior meetings 0/3/5 → priming lists 0/3/newest 3
- [ ] 10.60 [L1] test-plan #60: maxMinutes reached → normal stop path
- [ ] 10.61 [L1] test-plan #61: Speaker naming: enrolled voices named by overlap; unenrolled [Speaker n]; mic operator name; frontmatter marks…
- [ ] 10.62 [L1] test-plan #62: Diarization/labelling error or empty library · archive with channel labels + note
- [ ] 10.63 [L1] test-plan #63: keepAudio off · no WAV remains after archive; on · WAV kept in scratch only
- [ ] 10.64 [L1] test-plan #64: status.json write → badge updated without timer; fs.watch miss recovered on next onEvent
- [ ] 10.65 [L1] test-plan #65: Dictation badge starting mic until transcriber live, then recording
- [ ] 10.66 [L3] test-plan #66: Dictation badge starting mic→recording→idle; delivery-failed distinct
- [ ] 10.67 [L3] test-plan #67: Non-secure context hides browser option
- [ ] 10.68 [L3] test-plan #68: Browser-mic failure states distinct
- [ ] 10.69 [L3] test-plan #69: Shared folder-scoped knowledge route
- [ ] 10.70 [L3] test-plan #70: Folder rows without a session
- [ ] 10.71 [L3] test-plan #71: Live wall link (copilot header, toast) hidden (no plugin / no wall) / opens `/folder/<cwd>/wall` / fallback `/apps/wall/…`
- [ ] 10.72 [L3] test-plan #72: Start dialog disclosure incl. audio recording + deletion + archive path
- [ ] 10.73 [L3] test-plan #73: Meeting phases on folder row and both session cards
- [ ] 10.74 [L3] test-plan #74: Knowledge view lists archived meetings
- [ ] 10.75 [L3] test-plan #75: Settings without session: key source + voiceprint library status
- [ ] 10.76 [L2] test-plan #76: Restart during browser dictation · no stale row, no orphan
- [ ] 10.77 [L2] test-plan #77: No sox/parec · preflight blocks server capture
- [ ] 10.78 [L2] test-plan #78: Sustained meeting with fake recorder · no slow tick; dashboard health responsive (server only coordinates)

### Manual verification (deferred post-merge by ship-change)

- [ ] 10.84 [L1] test-plan #84: Model resolution {override × global × unset} per role · override → global → pi default
- [ ] 10.85 [L1] test-plan #85: Resolved model ref missing from registry · preflight blocks, names role + ref + source
- [ ] 10.86 [L1] test-plan #86: Folder override write/clear · unknown folder rejected; "inherit" removes entry; set-copilot.config.json untouched
- [ ] 10.87 [L3] test-plan #87: Global settings shows default pickers; Folder settings › Plugins › Voice assistant shows override "inherit global (<ref>)"; save persists
- [ ] 10.88 [L1] test-plan #88: folder-settings-section claim without label rejected by manifest validator
- [ ] 10.89 [L1] test-plan #89: Folder settings Plugins group {0 claims → hidden · claim → entry · disabled → hidden + fallback}
- [ ] 10.90 [L1] test-plan #90: /folder/:cwd/settings/plugins/<id> {claiming → section with cwd · global-only plugin → invalid-page fallback}
- [ ] 10.91 [L1] test-plan #91: Folder section render error isolated by slot error boundary
- [ ] 10.92 [L1] test-plan #92: composer-toolbar-action {no claim → unchanged · claim → before send/stop · no ariaLabel → rejected}
- [ ] 10.93 [L1] test-plan #93: composer handle insertAtCursor at caret / unfocused append / snapshot+restore / stale handle no-op
- [ ] 10.94 [L1] test-plan #94: submit() honours Steer|Queue while streaming
- [ ] 10.95 [L1] test-plan #95: Delivery {draft · send ≥3 words · send <3 words · send while streaming+Queue}
- [ ] 10.96 [L1] test-plan #96: Cancel (Esc / hold released before live) · transcriber ended, draft restored, agent turn not aborted
- [ ] 10.97 [L1] test-plan #97: Composer gone at hand-over {draft → retained+offered · send → sendToSession · send false → retained}
- [ ] 10.98 [L3] test-plan #98: Mic visible with text, attachment, while streaming, and at narrow width (not in ⋯)
- [ ] 10.99 [L3] test-plan #99: Mic states starting mic→recording→processing→idle; start timeout → stage error + Retry; second dictation appends at caret
- [ ] 10.79 test-plan #79: Real mic dictation quality and start latency (test-plan: manual-only)
- [ ] 10.80 test-plan #80: Real two-party call: capture, alerts, wall, archive with named speakers (test-plan: manual-only)
- [ ] 10.81 test-plan #81: kill -9 dashboard and, separately, a transcriber pi process during a meeting · orphans reaped, mic released (test-plan: manual-only)
- [ ] 10.82 test-plan #82: Browser dictation over zrok from a phone (test-plan: manual-only)
- [ ] 10.83 test-plan #83: Playbook leak check on a dry run (test-plan: manual-only)

## 11. Discipline checkpoints

- [ ] 11.1 `nodejs-expert`: extensions' child ownership, poll/backpressure in the extension, coordinator sequencing, `fs.watch` status.
- [ ] 11.2 `react-expert`: folder row, start dialog, badges, AudioWorklet, bridge hook.
- [ ] 11.3 `Audit`: guard + subagents, spoken injection, wall-input, transcriber `noTools` + key path, ingest under `/live/*`, archive PII, audio retention, kb config write.
- [ ] 11.4 `security-hardening` before 4.4, 5.7 and 6.9.
- [ ] 11.5 `performance-optimization`: soak; confirm the server event loop is untouched by audio and batches.
- [ ] 11.6 `observability-instrumentation`: phases, spawn/exit, pre-read, batch delivery/coalesce/truncate, naming outcome, archive + reindex, guard blocks (tool name only).
- [ ] 11.7 `doubt-driven-review`: `capture-source.patch`, subagent guard coverage, the notes one-shot write.
- [ ] 11.8 `DocScribe`: package `AGENTS.md`; `docs/architecture.md` (transcriber/copilot sessions, own-system mapping, kb archive).
- [ ] 11.9 `review-code` before commit.

## 12. Build & verify

- [ ] 12.1 `npm test`; `npm run quality:changed`.
- [ ] 12.2 `npm run build && curl -X POST http://localhost:8000/api/restart`.
- [ ] 12.3 Manual: dictation (server + browser), including start latency; a dry run with the leak check; a real meeting through archive with named speakers and notes; the next meeting's priming lists it.
