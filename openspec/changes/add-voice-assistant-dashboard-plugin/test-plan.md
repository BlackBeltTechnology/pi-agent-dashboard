# Test Plan — add-voice-assistant-dashboard-plugin

Scenario catalog (stage: design, **revised 2026-10-03** for the child-process engine and the wall split). The `disposition` column is the source of truth the fold step and `ship-change`'s defer rule read. Wall rendering, `/live` asset relativity, wall exposure and popout scenarios moved to `add-voice-wall-plugin/test-plan.md`.

**Levels** — L1 `packages/*/src/**/__tests__/*.test.ts` (vitest) · L2 `qa/tests/*.sh` (process smoke, no rendered-UI asserts) · L3 `tests/e2e/*.spec.ts` (Playwright vs docker harness; port from `.pi-test-harness.json`) · `—` manual.

## Gate outcomes

| Slot | Resolution |
|---|---|
| Backpressure cap | Configurable; default **200 lines OR 32 KB**. Tests assert the default. |
| STT reconnect | Upstream unbounded policy adopted (verified `32b6a7d`); plugin surfaces `reconnecting(n)` from child stderr. |
| Latency | Deferred; only host-stability is tested. |
| Browser-mic format | Fixed from vendored `soniox-rt.ts` at implementation; tests assert "matches server-local path". |
| Engine placement | Children owned by spawned transcriber/copilot sessions (design D3). L1 tests drive the extensions with a fake pi extension host and spawn real runners against fake recorder/STT fixtures. |
| `onEvent` reply shape | Established at implementation from `automation-plugin`'s handling; #24/#44 assert final-only. |
| Copilot session | Fresh per meeting (spawned, owner-stamped, preset + guard); continuity via kb archive. |

## New infra needed

- L1: a fake recorder binary on `PATH` (emits PCM from a fixture) and a fake STT endpoint (local WS) so runners run end-to-end without hardware. Package-local test fixtures, no new tier.
- L3: docker-harness fixture that sets the fake recorder/STT env — extension of the existing harness.

## Scenarios

| # | Class | Technique | Level | Disposition | Input · Trigger · Observable |
|---|---|---|---|---|---|
| 1 | edge-case | state-transition | L1 | automated | `dict-start` → transcriber spawned (noTools, transcriber ext, owner, nonce) → `live` → `dict-end` sends `/voice-stop` → `handover.json` → `{runId,text}` returned once to the requesting client → transcriber ended |
| 2 | error-handling | illegal edge | L1 | automated | `dict-end` without start · nothing spawned or sent |
| 3 | error-handling | fault injection | L1 | automated | `handover.json` with empty `text`, non-empty `raw` · raw delivered |
| 4 | error-handling | fault injection | L1 | automated | Delivery `send`, no composer, `sendToSession` false · delivery-failed, text retained |
| 5 | edge-case | EP | L1 | automated | Silence-only dictation · nothing sent, transcriber ended |
| 6 | edge-case | decision table | L1 | automated | Preflight {config version × key resolves × tooling × knowledge × kb covers archive × ffmpeg/model for naming} · allow / block / warn per combo |
| 7 | edge-case | decision table | L1 | automated | Knowledge gate · neither blocked; kb or sources alone allowed |
| 8 | error-handling | state-transition | L1 | automated | Either meeting session ends unexpectedly · meeting stops, partial archive, other session ended |
| 9 | error-handling | fault injection | L1 | automated | `onShutdown` during meeting · both sessions aborted |
| 10 | edge-case | illegal edge | L1 | automated | Second start for running folder meeting / dictation pair · idempotent |
| 11 | edge-case | decision table | L1 | automated | Device guard: server dictation in A vs meeting in B · refused naming A; browser dictation exempt |
| 12 | edge-case | BVA | L1 | automated | Copilot ext pending payload cap−1/cap/cap+1 · whole / whole / oldest dropped + marker |
| 13 | edge-case | state-transition | L1 | automated | Copilot ext: batch while idle → `sendUserMessage(followUp)`; batch while busy → pending, flushed on `agent_end` as one message |
| 14 | edge-case | EP | L1 | automated | `{"type":"command"}` / name-addressed line mid-turn · delivered as `steer` immediately |
| 15 | error-handling | fault injection | L1 | automated | Transcriber: reconnect lines then transcript · `status.json` `reconnecting (n)` → `live`; terminal error → `error` |
| 16 | error-handling | fault injection | L1 | automated | Capture child exits 1 · transcriber phase `error` with stderr tail; pi process survives |
| 17 | security | invariant | L1 | automated | Server module graph · no vendored capture/poll/handover/stitch-run, no `loadConfig` |
| 18 | error-handling | fault injection | L1 | automated | `sox` absent · transcriber `error` naming the tool |
| 19 | security | invariant | L1 | automated | Child env allowlist; dashboard env untouched; key only via extensionConfig; transcriber spawn has `noTools` |
| 20 | edge-case | invariant | L1 | automated | Quiet batch · nothing delivered |
| 21 | edge-case | invariant | L1 | automated | Delivered batch contains transcript lines only (policy not prepended) |
| 22 | edge-case | invariant | L1 | automated | Redaction-matching line delivered unredacted to copilot |
| 23 | edge-case | protocol | L1 | automated | Copilot ext poll parser: lines+sentinel / `capture-dead` / garbage / over-long / unknown |
| 24 | edge-case | decision table | L1 | automated | Mirror {off,on} × {substantive final, filler, empty, delta, tool output} · only on+substantive final appended |
| 25 | security | decision table | L1 | automated | `wall-input` × {not allowed, allowed} · dropped+logged / `[wall operator]:` follow-up |
| 26 | edge-case | invariant | L1 | automated | Zero kb queries per transcript line |
| 27 | edge-case | decision table | L1 | automated | Backend selection kb / fallback / "kb unavailable" |
| 28 | edge-case | contract suite | L1 | automated | Both knowledge backends pass one suite |
| 29 | edge-case | EP | L1 | automated | Status-faceted decisions on kb; flat on fallback |
| 30 | error-handling | fault injection | L1 | automated | Config `PUT` path escape rejected |
| 31 | error-handling | decision table | L1 | automated | Routes × {untrusted unauth, folder outside allow-list} rejected before I/O |
| 32 | security | invariant | L1 | automated | Key resolution: `video-transcription` config used; `ctx.credentials` override wins; `GET` reports source + set/unset only |
| 33 | edge-case | invariant | L1 | automated | Old config migrated, unknown fields preserved |
| 34 | security | invariant | L1 | automated | Upstream hand-over hook commands never executed |
| 35 | edge-case | state-transition | L1 | automated | Bridge mount states |
| 36 | edge-case | state-transition | L1 | automated | Bridge provider stack with `FolderEditorView` |
| 37 | edge-case | EP | L1 | automated | Undecodable `encodedCwd` |
| 38 | edge-case | invariant | L1 | automated | Ingest format mismatch rejected |
| 39 | edge-case | state-transition | L1 | automated | Ingest port in `status.json` → live row; transcriber end → row deleted |
| 40 | error-handling | fault injection | L1 | automated | Activation reap of live owners; runtime dir outside scratch refused |
| 41 | edge-case | state-transition | L1 | automated | Meeting start order: copilot spawned + primed before transcriber spawn; wall after |
| 42 | error-handling | fault injection | L1 | automated | Spawn timeout (either role) · abort, no children left |
| 43 | edge-case | state-transition | L1 | automated | Two meetings · different sessions and runtime dirs |
| 44 | edge-case | state-transition | L1 | automated | Pre-read line → `ready`; timeout → transcriber started, "unconfirmed" |
| 45 | edge-case | invariant | L1 | automated | Policy additive on `before_agent_start`; bridge coexistence both orders |
| 46 | edge-case | invariant | L1 | automated | Policy present after many turns |
| 47 | edge-case | EP | L1 | automated | `wall_emit` valid / invalid / no wall / array |
| 48 | edge-case | EP | L1 | automated | `copilot_alert` notify / non-notify |
| 49 | edge-case | EP | L1 | automated | `meeting_transcript` since turn N |
| 50 | security | decision table | L1 | automated | Guard × {in-preset, `bash` under meeting, foreign ext tool, MCP/codemode, path escape incl. symlink, `bash` under meeting+scripts} |
| 51 | security | invariant | L1 | automated | Subagent started by copilot calls out-of-preset tool · blocked (else `Agent` removed from preset — recorded) |
| 52 | security | decision table | L1 | automated | Owner gating × {owner, other principal, local operator} |
| 53 | edge-case | state-transition | L1 | automated | Stop sequence: `/voice-stop` → `archived` → `/voice-meeting-ended` → notes → both ended → wall stopped → one reindex |
| 54 | edge-case | invariant | L1 | automated | Dry run · no archive, notes, reindex |
| 55 | edge-case | BVA | L1 | automated | Archive name collision suffix |
| 56 | security | invariant | L1 | automated | Notes turn one-shot write path only |
| 57 | error-handling | fault injection | L1 | automated | Notes failure does not block archive/reindex |
| 58 | edge-case | decision table | L1 | automated | kb coverage {covered, offer→`PUT /api/kb/config`, no kb warn} |
| 59 | edge-case | BVA | L1 | automated | Prior meetings 0/3/5 → priming lists 0/3/newest 3 |
| 60 | edge-case | BVA | L1 | automated | `maxMinutes` reached → normal stop path |
| 61 | edge-case | EP | L1 | automated | Speaker naming: enrolled voices named by overlap; unenrolled `[Speaker n]`; `mic` operator name; frontmatter marks machine-assigned (fake diarizer + fake voiceid) |
| 62 | error-handling | fault injection | L1 | automated | Diarization/labelling error or empty library · archive with channel labels + note |
| 63 | security | invariant | L1 | automated | `keepAudio` off · no WAV remains after archive; on · WAV kept in scratch only |
| 64 | edge-case | state-transition | L1 | automated | `status.json` write → badge updated without timer; `fs.watch` miss recovered on next `onEvent` |
| 65 | edge-case | state-transition | L1 | automated | Composer mic `starting mic` until transcriber `live`, then `recording` |
| 66 | frontend-quirk | state-convergence | L3 | automated | Composer mic starting mic→recording→idle; retained-text offer distinct |
| 67 | frontend-quirk | state-transition | L3 | automated | Non-secure context hides browser option |
| 68 | frontend-quirk | decision table | L3 | automated | Browser-mic failure states distinct |
| 69 | frontend-quirk | state-convergence | L3 | automated | Shared folder-scoped knowledge route |
| 70 | frontend-quirk | state-transition | L3 | automated | Folder rows without a session |
| 71 | frontend-quirk | decision table | L3 | automated | Live wall link (copilot header, toast) hidden (no plugin / no wall) / opens `/folder/<cwd>/wall` / fallback `/apps/wall/…` |
| 72 | frontend-quirk | invariant | L3 | automated | Start dialog disclosure incl. audio recording + deletion + archive path |
| 73 | frontend-quirk | state-convergence | L3 | automated | Meeting phases on folder row and both session cards |
| 74 | frontend-quirk | invariant | L3 | automated | Knowledge view lists archived meetings |
| 75 | frontend-quirk | invariant | L3 | automated | Settings without session: key source + voiceprint library status |
| 76 | error-handling | state-transition | L2 | automated | Restart during browser dictation · no stale row, no orphan |
| 77 | error-handling | fault injection | L2 | automated | No `sox`/`parec` · preflight blocks server capture |
| 78 | performance | soak | L2 | automated | Sustained meeting with fake recorder · no `slow tick`; dashboard health responsive (server only coordinates) |
| 79 | manual | — | — | manual-only | Real mic dictation quality and start latency |
| 80 | manual | — | — | manual-only | Real two-party call: capture, alerts, wall, archive with named speakers |
| 81 | manual | — | — | manual-only | `kill -9` dashboard and, separately, a transcriber pi process during a meeting · orphans reaped, mic released |
| 82 | manual | — | — | manual-only | Browser dictation over zrok from a phone |
| 83 | manual | — | — | manual-only | Playbook leak check on a dry run |
| 84 | edge-case | decision table | L1 | automated | Model resolution {override × global × unset} per role · override → global → pi default |
| 85 | error-handling | fault injection | L1 | automated | Resolved model ref missing from registry · preflight blocks, names role + ref + source |
| 86 | edge-case | state-transition | L1 | automated | Folder override write/clear · unknown folder rejected; "inherit" removes entry; set-copilot.config.json untouched |
| 87 | frontend-quirk | state-transition | L3 | automated | Global settings shows default pickers; Folder settings › Plugins › Voice assistant shows override "inherit global (<ref>)"; save persists |
| 88 | error-handling | equivalence | L1 | automated | folder-settings-section claim without label rejected by manifest validator |
| 89 | edge-case | decision table | L1 | automated | Folder settings Plugins group {0 claims → hidden · claim → entry · disabled → hidden + fallback} |
| 90 | edge-case | decision table | L1 | automated | /folder/:cwd/settings/plugins/<id> {claiming → section with cwd · global-only plugin → invalid-page fallback} |
| 91 | error-handling | fault injection | L1 | automated | Folder section render error isolated by slot error boundary |
| 92 | edge-case | decision table | L1 | automated | composer-toolbar-action {no claim → unchanged · claim → before send/stop · no ariaLabel → rejected} |
| 93 | edge-case | BVA | L1 | automated | composer handle insertAtCursor at caret / unfocused append / snapshot+restore / stale handle no-op |
| 94 | edge-case | state-transition | L1 | automated | submit() honours Steer|Queue while streaming |
| 95 | edge-case | decision table | L1 | automated | Delivery {draft · send ≥3 words · send <3 words · send while streaming+Queue} |
| 96 | error-handling | state-transition | L1 | automated | Cancel (Esc / hold released before live) · transcriber ended, draft restored, agent turn not aborted |
| 97 | error-handling | fault injection | L1 | automated | Composer gone at hand-over {draft → retained+offered · send → sendToSession · send false → retained} |
| 98 | frontend-quirk | invariant | L3 | automated | Mic visible with text, attachment, while streaming, and at narrow width (not in ⋯) |
| 99 | frontend-quirk | state-transition | L3 | automated | Mic states starting mic→recording→processing→idle; start timeout → stage error + Retry; second dictation appends at caret |

## Summary

- **automated: 94** (L1 78 · L3 13 · L2 3) → each folds to one task
- **manual-only: 5** → deferred post-merge by `ship-change`
- Revision 2026-10-04: transcription in a spawned transcriber session (#1, #15–#19, #39, #60, #64–#65); copilot self-polls (#12–#14, #23); our diarization + speaker naming (#61–#63); start/stop sequencing (#41, #53).
- Revision: model selection — global default + per-folder override (#84–#87, D20); folder-settings-section core seam (#88–#91, D21).
- Revision: dictation moves to the composer toolbar (`composer-toolbar-action`, D22); draft by default, `send` configurable (#1, #3–#4, #65–#66, #92–#99).
