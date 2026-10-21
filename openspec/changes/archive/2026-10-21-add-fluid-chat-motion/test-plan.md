# Test Plan — add-fluid-chat-motion

Stage: design   Generated: 2026-10-20

No clarifications outstanding. Two internal inconsistencies found while filling triples were fixed in `specs/chat-motion/spec.md` before this plan:
- the trailing-edge clear time is now 700 ms after the last arrival (400 ms deadline + fade-out);
- the completion cue is now ≤ 300 ms.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | chat-motion: preference default | EP | L1 | automated | `DisplayPrefs` object without `chatMotion`; each of the 3 `DISPLAY_PRESETS` | `mergeDisplayPrefs(global, {})` / preset apply | effective `chatMotion === true` in all 4 cases |
| E2 | chat-motion: legacy backfill | state | L1 | automated | `preferences.json` whose `displayPrefs` has no `chatMotion` | preferences store load | loaded `displayPrefs.chatMotion === true`; never `undefined` |
| E3 | chat-motion: partial PATCH preserves | state | L1 | automated | stored `chatMotion: false` | `PATCH /api/preferences/display {notifyMinLevel:"warning"}` | stored + broadcast `chatMotion === false` |
| E4 | chat-motion: runtime rollback | state | L1 | automated | stored `chatMotion: true` | `PATCH /api/preferences/display {chatMotion:false}` | stored + broadcast `chatMotion === false` (both `setDisplayPrefs` literals carry the field) |
| E5 | chat-motion: override wins | decision-table | L1 | automated | global `true`; session A override `false`; session B no override | compute effective prefs for A and B | A `false`, B `true` |
| E6 | chat-motion: inactive conditions | decision-table | L1 | automated | 8 combos of pref {T,F} × reduced-motion {T,F} × document {visible,hidden} | `useChatMotion` evaluates; media query / `visibilitychange` fire | `true` only for (pref T, reduced F, visible); flips within the same tick of each event |
| E7 | chat-motion: entry seeding | state-transition | L1 | automated | session with 30 tool calls, replay-aware host, following | first commit for that session in a fresh `ChatView` | 0 elements entering; all 30 ids recorded |
| E8 | chat-motion: switch-back | state-transition | L1 | automated | sessions A and B; 3 tool calls arrive for A while B is shown | switch B→A | 0 elements entering on A's first commit after the switch |
| E9 | chat-motion: bulk guard | BVA | L1 | automated | following, replay-aware, motion active | one commit adds 4 new tool ids; another adds 5 | 4 → all 4 entering; 5 → none entering |
| E10 | chat-motion: replay-unaware host | decision-table | L1 | automated | `ChatView` rendered without the `replayInFlight` prop (team-app shape), motion active, following | 1 new live tool call | no entry class on the row; pacing still active for streamed text |
| E11 | chat-motion: re-parenting | state-transition | L1 | automated | 2 identical completed tool rows on screen | 3rd identical call completes → ×N group forms; then a 4th new call joins | group row not entering; only the 4th member's line entering |
| E12 | chat-motion: steering multiset | state-transition | L1 | automated | steering `["A","A"]` shown | head consumed → `["A"]`; later `["A","A"]` again | consume: no element entering; re-add: exactly one card entering |
| E13 | chat-motion: filter toggle | state | L1 | automated | `toolCalls.bash=false`; 2 bash calls arrive live | set `toolCalls.bash=true` | the 2 bash rows render with no entry class |
| E14 | chat-motion: off-screen arrival | state | L1 | automated | scroll-locked 2000 px above bottom | tool row arrives; then scroll to bottom (row mounts) | row mounts without entry class |
| E15 | chat-motion: commit swaps | state-transition | L1 | automated | visible streaming bubble; visible optimistic pending card | `message_end` commit; server user message confirms the card | committed assistant row and confirmed user row have no entry class; confirmed card bounding box equals the pending card's (Δ ≤ 1 px) |
| E16 | chat-motion: lag bound | BVA | L1 | automated | `usePacedText` active, fake timers + fake rAF at 60 Hz | 100-char bursts every 50 ms for 3 s | every char visible ≤ 500 ms after its burst; ≥ 2 distinct shown lengths between consecutive bursts |
| E17 | chat-motion: stall dump | BVA | L1 | automated | idle 600 ms, backlog 0 | 400-char delivery | fully shown ≤ 500 ms after delivery |
| E18 | chat-motion: snap threshold | BVA | L1 | automated | active, shown 0 | backlog 4000 vs 4001 chars | 4000 → paced (shown < target next frame); 4001 → shown === target next render |
| E19 | chat-motion: non-prefix target | state | L1 | automated | shown "Hello wor" | target becomes "Goodbye" | shown === "Goodbye" next render |
| E20 | chat-motion: reactivation sync | state-transition | L1 | automated | active, shown 100 of 500 | `active` false (scroll-lock), target grows to 900, `active` true | while inactive shown 900; on reactivation shown never < 900 |
| E21 | chat-motion: frozen precedence | decision-table | L1 | automated | frozen (selection clock true), shown 200 | 5000 chars arrive + document hidden; then unfreeze 2 s later | shown stays 200 while frozen; on unfreeze all chars older than 400 ms shown in the same render |
| E22 | chat-motion: rAF throttled | fault-injection (delay) | L1 | automated | active, fake rAF never fires, document visible | 300-char delivery | `setTimeout` backstop shows all 300 chars ≤ 500 ms after delivery |
| E23 | chat-motion: target reset | state | L1 | automated | queue holds entries up to offset 800 | target resets to "" then "Hi" (new turn) | shown never exceeds target length; queue empty after reset |
| E24 | chat-motion: reasoning modes | decision-table | L1 | automated | live reasoning; `reasoningInlineFlow` {T,F} × expanded {T,F} | reasoning bursts arrive | paced only for (inline T, expanded T); others render applied text immediately with no rAF |
| E25 | chat-motion: hidden document | state-transition | L1 | automated | active, mid-reveal (shown 50/400), 2 tool rows arriving | `visibilitychange` → hidden, more text arrives, → visible | on return shown === target; arrived rows have no entry class |
| E26 | chat-motion: glide threshold | BVA | L1 | automated | following, motion active, clientHeight 600 | live growth Δ = 600 vs Δ = 601 | 600 → glide (≥ 2 intermediate writes); 601 → single instant write to bottom |
| E27 | chat-motion: glide frame-rate independence | EP | L1 | automated | Δ = clientHeight (600) | glide stepped at 60 Hz and at 120 Hz | both settle (|Δ| < 2 px snap) ≤ 500 ms; settle times differ ≤ 17 ms |
| E28 | chat-motion: measure re-target guards | decision-table | L1 | automated | glide in flight | `onChange` measure growth with (a) splice suppression on, (b) remaining Δ > clientHeight, (c) guards pass and Δ ≤ clientHeight | (a),(b) glide cancelled + one instant write; (c) target updated, no write from `onChange` |
| E29 | chat-motion: completion cue | decision-table | L1 | automated | tool row mounted running | flip to done / error / elided under each condition: live-follow non-bulk replay-aware; mount-as-done; flip inside replay commit; flip inside bulk commit; scroll-locked; later manual expand | cue (status icon with entry class) only for live-follow done/error; error shows the alert icon; none in every other case |
| E30 | chat-motion: trailing-edge skips | decision-table | L1 | automated | reveal point inside: prose / fenced code / mermaid / KaTeX / inline `code` / `dir=rtl` prose | reveal step commits | overlay shown only for ltr prose; hidden in the other 5 cases |
| E31 | chat-motion: trailing edge leaves DOM untouched | invariant | L1 | automated | streamed prose containing `packages/client/src/index.css` and a URL | render with overlay active vs motion off | the markdown subtree `innerHTML` is identical; the path and URL render as `FileLink`/`UrlLink` in both |
| E32 | chat-motion: quiet costs nothing | invariant | L1 | automated | motion active, stream ended, glide at rest | advance fake time 10 s with no events | 0 `requestAnimationFrame` calls from pacing/glide/overlay modules |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | chat-motion: render cost (design D4 gate) | tail-latency, A/B ratio | L3 | automated | faux stream ≥ 4000 chars of code + list, run once motion on, once off (opt-in `PW_PERF=1`) | tail scripting time (CDP `Performance.getMetrics` `ScriptDuration` delta) motion-on ≤ 1.5× motion-off | full stream duration |
| P2 | chat-motion: frame budget (design D4 gate) | tail-latency | L3 | automated | same stream, motion on (opt-in `PW_PERF=1`) | p95 frame interval from an in-page rAF sampler < 16.7 ms on the CI reference runner | full stream duration |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chat-motion: live entry (real CSS) | state-convergence | L3 | automated | following at bottom, motion on, `[[faux:tool-read]]` | live tool call starts | the new row's computed `opacity` sampled on its first rAF is < 1, then === 1 within 300 ms; rows mounted by scrolling back afterwards read `opacity` 1 on their first frame |
| F2 | chat-motion: paced reveal (real browser) | state-convergence | L3 | automated | `[[faux:slow-stream]]` with 50 ms coalesced bursts | sample the tail `textContent.length` every rAF for 2 s | ≥ 2 distinct lengths between consecutive WS text updates in ≥ 80% of burst intervals; final text equals the committed message |
| F3 | chat-motion: glide follow | state-convergence | L3 | automated | following at bottom, motion on | a tool row arrives below the viewport | `scrollTop` samples show ≥ 3 intermediate values; at bottom (≤ 1 px) within 500 ms; scroll-to-bottom button never visible; follow still on (next growth followed) |
| F4 | chat-motion + chat-scroll-lock: keyboard mid-glide | state-transition | L3 | automated | glide in progress, focus inside the transcript | press PageUp | button visible; for 2 s of further streaming `scrollTop` never increases toward the bottom |
| F5 | chat-motion + chat-scroll-lock: wheel-up mid-glide | state-transition | L3 | automated | glide in progress | `mouse.wheel(0, -400)` | lock engaged (button visible); no pull-back during 2 s of streaming |
| F6 | chat-scroll-lock: foreign scroll mid-glide (scrollbar-drag analogue) | state-transition | L3 | automated | glide in progress | `scrollTop -= 300` written directly (no input event, models a scrollbar drag / find-in-page) | the event falls through: button visible, no pull-back during 2 s of streaming |
| F7 | chat-motion: relocation mid-glide | state-transition | L3 | automated | glide in progress | switch to another session; separately, jump to an earlier turn via the turn bar | lands instantly at its target; no `scrollTop` change on the next 10 frames |
| F8 | chat-motion: selection freeze | state-convergence | L3 | automated | streaming answer, motion on | drag-select 20 chars inside the tail while text keeps arriving 2 s; release | selection stays non-collapsed with the same text during the hold; after release the tail catches up and contains all received text within 500 ms |
| F9 | chat-motion: trailing edge lifecycle | state-convergence | L3 | automated | `[[faux:slow-stream]]` prose | during streaming, then after the last chunk | while revealing, overlay element present with computed `opacity` > 0 at the last line's right edge; 700 ms after the last arrival, the overlay is absent or `opacity` 0 |
| F10 | chat-motion: completion cue (real CSS) | state-convergence | L3 | automated | running tool row on screen, following | tool completes live | status icon computed `opacity` < 1 on its first frame, === 1 within 300 ms; after scroll away and back the icon reads `opacity` 1 on its first frame |
| F11 | chat-motion + ui-animation-energy: idle exemption | state-convergence | L3 | automated | no input for > 5 s (root has `fx-idle`), session streaming | text and a tool row arrive; stream ends | arrived row reaches `opacity` 1; tail text equals the received text; `chat-scroll-container` loses its `data-chat-motion-busy` attribute (set only while pacing/glide/overlay schedule frames) ≤ 1 s after the last arrival and keeps it absent for the next 5 s |
| F12 | chat-motion: reduced motion | decision-table | L3 | automated | `emulateMedia({reducedMotion:'reduce'})` | tool row arrives; text streams; growth while following | row `opacity` 1 on its first frame; tail text length equals the received length on every WS update; `scrollTop` at bottom in the same frame as growth (no intermediate samples) |
| F13 | chat-motion: motion off equals today | decision-table | L3 | automated | `chatMotion=false` via View popover | same as F12 | same observables as F12 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | chat-motion: reconnect replay is bulk | fault-injection (abort) | L1 | automated | WS drops mid-stream; reconnect delivers an `event_replay` batch with 12 rows | replay applied | no element entering; pacing snaps when backlog > 4000; no completion cue for tools flipped inside the batch |
| X2 | chat-motion: abort mid-stream | fault-injection (abort) | L1 | automated | user aborts while backlog = 300 chars and a glide is in flight | `message_end` arrives | committed row shows full content in that commit; no overlay; the glide ends at bottom ≤ 500 ms or is superseded by an instant pin |
| X3 | chat-motion: preference off mid-motion | state-transition | L1 | automated | backlog 300 chars, glide in flight | `chatMotion` override set `false` | the next render shows all received text; one instant pin to bottom; 0 further rAF calls from motion modules |
| X4 | chat-motion: stalled stream | fault-injection (delay) | L1 | automated | provider stalls 3 s mid-turn (no deltas) | time passes with backlog 0 | 0 rAF calls during the stall; the overlay fades out (opacity 0) ≤ 700 ms after the last arrival |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | chat-motion: perceived fluidity | visual/subjective | — | manual-only | live dashboard session; transports: fast model, slow model, provider with stalls | watch a long answer with tool calls | [judgment: text reads as continuous, not laggy; rows settle without jank] |
| M2 | chat-motion: trailing-edge colour match | visual/subjective | — | manual-only | base dark, base light, one non-base palette from `themes.ts` | watch streaming prose incl. the shimmer sweep | [judgment: no visible patch or band at the reveal point] |
| M3 | chat-motion: mobile touch | visual/subjective | — | manual-only | iOS Safari + Android Chrome on the LAN URL | stream while following; flick up mid-glide | [judgment: glide feels natural; a flick escapes immediately with no pull-back] |

---

## Coverage summary

- Requirements covered: 12/12. The chat-motion spec has 10 ADDED requirements, plus MODIFIED ui-animation-energy (F11) and MODIFIED chat-scroll-lock (F3–F7, both its requirements).
- Scenarios by class: edge 32 · perf 2 · frontend 13 · error 4 · manual 3
- Scenarios by level: L1 36 · L2 0 · L3 15 · — 3
- Scenarios by disposition: automated 51 · manual-only 3

## New infra needed

- A `data-chat-motion-busy` attribute on `chat-scroll-container`, present only while pacing, the glide or the overlay schedule frames. It is a production DOM signal (cheap, no build flag) that gives F11 an observable.
- A faux scenario delivering ≥ 4000 chars of code + list as a slow stream for P1/P2, if `[[faux:slow-stream]]` is shorter. Check the faux scenario catalogue first.
- Everything else extends existing harnesses: `[[faux:slow-stream]]`, `[[faux:tool-read]]`, `[[faux:long-transcript]]`, `[[faux:thinking-text]]`, plus the CDP perf probe pattern from `chat-render-perf.spec.ts`.
