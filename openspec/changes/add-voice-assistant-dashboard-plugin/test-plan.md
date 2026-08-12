# Test Plan — add-voice-assistant-dashboard-plugin

Standalone scenario catalog produced by `scenario-design` (stage: design, HARD gate — 4 gaps raised and answered before writing; see "Gate outcomes"). Separate from `tasks.md`; the `disposition` column is the source of truth the fold step and `ship-change`'s defer rule both read.

**Levels** — L1 `packages/*/src/**/__tests__/*.test.ts` (vitest) · L2 `qa/tests/*.sh|*.ps1` (process/CLI smoke, NO rendered-UI asserts) · L3 `tests/e2e/*.spec.ts` (Playwright vs docker harness; port from `.pi-test-harness.json` `dashboardPort`, never hardcoded) · `—` manual-only.

## Gate outcomes (were spec gaps, now decided)

| Slot | Resolution |
|---|---|
| Backpressure cap | Configurable in `set-copilot.config.json`; documented default **200 lines OR 32 KB**, whichever trips first. Tests assert the default. |
| STT reconnect bound | **5 attempts, exponential backoff capped at 30s**, then terminal error state. |
| Latency threshold | **Deferred** — no perf budget in v1. Only host-stability (no event-loop starvation) is tested. |
| Browser-mic audio format | Determined from vendored `soniox-rt.ts` during implementation; scenarios assert "matches the server-local path's format" without fixing numbers. |

## New infra needed

None. All rows route to existing tiers. L3 rows need a docker-harness fixture that fakes capture/STT (no real microphone in CI) — an extension of the existing harness, not a new level.

## Scenarios

| # | Class | Technique | Level | Disposition | Input · Trigger · Observable |
|---|---|---|---|---|---|
| 1 | edge-case | state-transition | L1 | automated | Capture idle for a pair · `dict-start` then `dict-end` with a non-empty transcript · exactly one `sendToSession` call carrying the stitched text; state returns to idle |
| 2 | error-handling | state-transition (illegal edge) | L1 | automated | Capture idle · `dict-end` fired without a preceding `dict-start` · no `sendToSession`, no throw, state stays idle |
| 3 | error-handling | fault injection (abort) | L1 | automated | Recording with buffered transcript · stitch throws · fail-open: raw transcript text is sent instead of dropping it |
| 4 | error-handling | fault injection (abort) | L1 | automated | Recording, target session disconnected · `dict-end` → `sendToSession` returns `false` · error state set AND stitched text retained for retry (not discarded) |
| 5 | edge-case | EP | L1 | automated | Recording that captured only silence · `dict-end` · empty-result path taken; no empty prompt sent to the session |
| 6 | edge-case | decision table | L1 | automated | Preflight flags {STT configured × audio tooling present × knowledge configured} · start requested · each reachable combination yields its specified allow/block outcome |
| 7 | edge-case | decision table | L1 | automated | Knowledge gate: neither kb-indexed nor `knowledge.sources` · copilot start · blocked; either one alone · allowed |
| 8 | error-handling | state-transition | L1 | automated | Copilot running for pair P · target session of P ends (no stop click) · `onSessionEnded` tears down capture, consumer, wall, live-server registration; map entry removed |
| 9 | error-handling | fault injection (abort) | L1 | automated | Capture active · dashboard process exits · spawned recorder child terminates with it (process-group kill); no orphan holds the microphone |
| 10 | edge-case | state-transition (illegal edge) | L1 | automated | Copilot already running for pair P · second start for P · idempotent — no second recorder, no second batch consumer |
| 11 | edge-case | decision table | L1 | automated | Dictation active in project A · copilot start in project **B** on the same host · refused, error names the holding capture (contention is host-wide, not per-project) |
| 12 | edge-case | BVA | L1 | automated | Pending coalesced payload at cap−1 line / exactly cap / cap+1 line (default 200 lines, 32 KB) · next batch merges · at/below cap dispatches whole; above cap drops oldest AND inserts a truncation marker |
| 13 | edge-case | EP | L1 | automated | Two batches produced while one is in flight · in-flight completes · both merge in arrival order (append, no line lost by merging) and dispatch once |
| 14 | edge-case | invariant | L1 | automated | Session-leg coalescing active and dropping oldest · same capture running · the wall leg still receives **every** line (drop is session-leg only) |
| 15 | error-handling | fault injection (delay+abort) | L1 | automated | STT socket drops mid-capture · reconnect path · exactly 5 attempts with exponential backoff capped at 30s, then terminal error state — never an unbounded loop |
| 16 | error-handling | fault injection (abort) | L1 | automated | Vendored code raises inside a batch · error surfaces · only that pair enters error state; other pairs and the host keep running |
| 17 | error-handling | fault injection (abort) | L1 | automated | Vendored emitter emits `'error'` with no other listener · error emitted · caught by the boundary's construction-time listener; no `uncaughtException` |
| 18 | error-handling | fault injection (abort) | L1 | automated | `sox` binary absent · recorder spawn · async ENOENT caught via `child.on('error')` (NOT by a try/catch around `spawn()`); pair enters error state |
| 19 | error-handling | fault injection (abort) | L1 | automated | Vendored callback throws synchronously inside a `setImmediate` · callback runs · process-level backstop attributes it to the pair; host survives |
| 20 | edge-case | invariant | L1 | automated | Copilot batch containing routine chit-chat only (no topics/urgency/question/command) · batch produced · no `sendToSession` call at all |
| 21 | edge-case | state-transition | L1 | automated | First batch of a run vs a later batch · each forwarded · first prepends the rendered policy; later batches are transcript-only |
| 22 | edge-case | invariant | L1 | automated | Line that wall-redaction would scrub · batch forwarded · session receives it **unredacted**; wall copy is redacted (boundary is deliberate) |
| 23 | performance | invariant (no threshold) | L1 | automated | Sustained batch production for a capture · loop runs · exactly one consumer per active pair, awaited (no overlapping ticks), and no knowledge-base query issued from the loop body |
| 24 | edge-case | invariant | L1 | automated | Transcript line arrives · per-line matching runs · keyword-matcher only; zero knowledge-base queries on the per-line path, on BOTH backend paths |
| 25 | edge-case | decision table | L1 | automated | Folder {kb-indexed × kb-admissible} · backend selection · indexed+admissible → kb; no index → fallback; admission-rejected → explicit "kb unavailable" outcome, never an empty result |
| 26 | edge-case | contract suite | L1 | automated | Same fixture folder · identical queries against kb backend and vendored fallback · both satisfy one shared `KnowledgeBackend` contract suite (no behavioural drift) |
| 27 | edge-case | EP | L1 | automated | Decisions carrying `status` frontmatter · kb backend active · grouped by status with per-status counts; fallback backend active · flat list, no counts |
| 28 | error-handling | fault injection | L1 | automated | Config `PUT` with a traversal / symlink / absolute path escaping the folder root · write attempted · rejected; nothing written outside the folder |
| 29 | error-handling | decision table | L1 | automated | Config + knowledge routes × {unauthenticated, folder outside allow-list} · request made · rejected before any disk read/write |
| 30 | edge-case | invariant | L1 | automated | Config containing an STT credential · `GET` then `PUT` with the masked field unchanged · response masks the secret; on-disk secret preserved, mask never written back |
| 31 | edge-case | invariant | L1 | automated | Config with fields the editor does not expose · save · unexposed fields round-trip untouched |
| 32 | edge-case | state-transition | L1 | automated | `SplitWorkspaceProvider` unmounted / not yet mounted · plugin calls the live-target bridge · logged no-op — no throw, no false success; availability check reports unavailable |
| 33 | edge-case | state-transition | L1 | automated | `SplitWorkspaceProvider` mounts then unmounts · bridge inspected · populated on mount, cleared on unmount (no stale impl bound to a dead tree) |
| 34 | edge-case | EP | L1 | automated | Route param `encodedCwd` that does not decode · knowledge overlay renders · explicit invalid-folder message, not an empty knowledge list |
| 35 | edge-case | invariant | L1 | automated | Browser audio whose sample format does not match the server-local path's contract · streamed to ingest · rejected with an explicit error; malformed audio never reaches the STT client |
| 36 | frontend-quirk | state-convergence | L3 | automated | Dictation start → recording → stop · action-bar/badge observed · converges idle→recording→idle; error and delivery-failed states each visually distinct |
| 37 | frontend-quirk | state-transition | L3 | automated | Page loaded over a non-secure context · dictation controls render · browser-mic option is **hidden**, not shown-and-failing |
| 38 | frontend-quirk | decision table | L3 | automated | Browser-mic selected with {permission denied, no input device, unsupported browser} · start attempted · each yields a distinct visible state, never a silent no-op |
| 39 | frontend-quirk | state-convergence | L3 | automated | Two sessions running in one folder · knowledge overlay opened from each · both reach the same single folder-scoped route (not two independent views) |
| 40 | frontend-quirk | state-transition | L3 | automated | Folder with knowledge but **no running session** · sidebar inspected · folder entry present and the overlay lists knowledge normally |
| 41 | frontend-quirk | state-convergence | L3 | automated | Live-target bridge unavailable in the shell · "View live wall" activated · falls back to the full-page main-origin `/live/<id>/` URL; button is never inert |
| 42 | frontend-quirk | state-transition | L3 | automated | Copilot stopped · wall URL re-requested · no longer resolves (registration removed), bounding the exposure window |
| 43 | frontend-quirk | invariant | L3 | automated | Meeting copilot start · confirmation rendered · discloses that system audio (the other party) is captured AND that forwarded content persists in the session's history |
| 44 | frontend-quirk | invariant | L3 | automated | Settings section opened with no session running anywhere · rendered · folder selector present and the editor is fully functional |
| 45 | error-handling | state-transition | L2 | automated | Dashboard restarted while a wall/ingest target was registered · restart · no stale registration accumulates in `preferences.json` across restarts |
| 46 | error-handling | fault injection | L2 | automated | Audio tooling (`sox`/`parec`) absent on the host · plugin preflight · reports the missing dependency and blocks server-local capture, naming the capture host |
| 47 | performance | soak | L2 | automated | Sustained capture with continuous batch production · run for a soak window · no `slow tick`-style event-loop starvation in server logs; the host stays responsive |
| 48 | manual | — | — | manual-only | Real microphone on a real host · dictate a paragraph and stop · transcription is accurate enough to be usable (subjective quality judgment, no automatable signal) |
| 49 | manual | — | — | manual-only | Real two-party call with system audio · run meeting copilot · the other party's speech is actually captured and attributed to the right speaker (requires real hardware + a live call) |
| 50 | manual | — | — | manual-only | Wall rendered in the embedded iframe · observe · upstream's own `wall.css` renders legibly inside the dashboard shell (visual/aesthetic judgment) |
| 51 | manual | — | — | manual-only | Vendored wall served behind `/live/<id>/` · open the wall · upstream's `wall.js` WebSocket actually connects through the path-prefixed opaque-origin proxy (verifies the unverified upstream seam; needs real vendored code) |
| 52 | manual | — | — | manual-only | Popout link activated in Electron, PWA, and mobile browser · observe · the main-origin `/live/<id>/` link behaves acceptably in each shell (cross-shell behaviour, no automatable oracle) |

## Summary

- **automated: 47** (L1 35 · L2 3 · L3 9) → each folds to exactly one task
- **manual-only: 5** → tagged manual tasks, deferred post-merge by `ship-change`, no test folded

Rows 51–52 exist because the design flags those seams as **unverifiable from this repo** until upstream is vendored — they are deliberate verification tasks, not gaps left open by accident.
