# Test Plan — add-craft-live-control

Stage: design   Generated: 2026-10-24

Hard gate resolved: performance thresholds set by the user (routed p95 ≤ 600 ms, pinned p95 ≤ 150 ms, L3, 50 requests, fakecraft).

Test doubles:
- **fakecraft**: the fixture app from design D8, served only with `PI_DASHBOARD_FIXTURE_PLUGINS=1`. It exposes `window.fakecraft.request`, an in-memory document, and the methods echo, sleep, oversize, malformed and save.
- **Control-enabled apps**: rows marked "per enabled app" run once for every profile with a `control` entry (VectorCraft from W1; FilmCraft, EffectCraft and W3 apps as their gates pass). The VectorCraft-specific rows run only once gate 1.1 is go.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Only eligible instances (path match) | decision-table | L1 | automated | probe with `path=/tmp/w/a.svg`, `realPath=/private/tmp/w/a.svg`, `relPath=a.svg`, `caseInsensitive=true`; tabs `{cwd:/tmp/w, path:A.SVG}`, `{cwd:/private/tmp/w, path:a.svg}`, `{cwd:/tmp/w, path:b.svg}` | client registry handles the probe | claims for the first two (status `eligible`), none for `b.svg`; with `caseInsensitive=false` the `A.SVG` tab does not claim |
| E2 | Only eligible instances (status order) | decision-table | L1 | automated | one instance per combination of {own session ≠ S, profile without `control`, frame `shimVersion` 2, not opened, tab inactive, page hidden, all good} | probe | statuses `wrong-session`, `unsupported`, `unsupported`, `not-ready`, `not-visible`, `not-visible`, `eligible`; the first failing rule wins when several fail |
| E3 | Exactly one instance (choice) | BVA | L1 | automated | eligible claims with `msSinceFocus` {60 000, 3 600 000}; then {599 999, 600 001}; then {600 001, 700 000}; then a tie {5 000, 5 000} arriving 20 ms apart | router chooses after the window | 1st → 60 000 claim; 2nd → 599 999 claim; 3rd → `ambiguous`, no run sent; tie → earlier claim |
| E4 | Only eligible instances (reason precedence) | decision-table | L1 | automated | claims with status sets {`not-ready`}, {`unsupported`,`not-visible`}, {`wrong-session`}, {} | window closes with no eligible claim | tool errors `not-ready`, `not-visible`, `not-open`, `not-open`; the `not-open` message names "open and visible on a device with full operating rights" |
| E5 | Exactly one instance (window) | BVA | L1 | automated | fake clock; first eligible claim at t=100 ms, second at t=399 ms, third at t=401 ms; separate run with no eligible claim | router window | window closes at 400 ms: the 399 ms claim is considered, the 401 ms claim is not; with no eligible claim the router answers at 2000 ms (±10 ms) |
| E6 | Requests are bounded (reply size) | BVA | L1 | automated | `control-result` with `result` serialized at 192 KiB − 1, 192 KiB, 192 KiB + 1; `error` at 2 KiB and 2 KiB + 1 | host and server validate | first two accepted; 192 KiB + 1 → `reply_too_large`; error over 2 KiB truncated to 2 KiB with `app_error` |
| E7 | Requests are bounded (rate) | BVA | L1 | automated | 20 routed requests in 10 s from session S, then a 21st; and a 21st `host.state` | router | 21st routed → `rate_limited`; `host.state` → served (exempt) |
| E8 | Requests are bounded (busy) | state-transition | L1 | automated | instance with a request in flight; a second arrives; then the first times out at 10 s; the late result arrives at 12 s; separately, no late result until 40 s | host frame-session | second → `busy`; after the timeout still `busy` until 12 s (late result) or until 40 s (30 s cap); then idle |
| E9 | Host refuses (method allowlist) | decision-table | L1 | automated | methods `engine.execute{command:"object.rectangle"}` (allowlisted), `engine.execute{command:"file.open"}`, `engine.execute{command:"object.rectangle", extra:1}`, `engine.execute{command:["a","b"]}`, `app.quit`, `ui.screenshot`, `host.state` | host policy | 1st forwarded; 2nd, 3rd, 4th, 5th → `denied` without posting to the frame; `ui.screenshot` forwarded; `host.state` answered by the host, never posted |
| E10 | Save routing (path stripped) | EP | L1 | automated | `engine.execute{command:<app save cmd>, params:{path:"/etc/x.svg"}}` | host policy | frame receives the command without `path`; reply carries `saveRequested:true`, `saveSeq`, `instance` |
| E11 | Never silently lost (agentPending) | state-transition | L1 | automated | instance clean; a non-read-only request is forwarded and answered `ok`, then `app_error`, then times out with no result; the shim reports `dirty:false`; then an own-file save is acknowledged with an agent `ok` arriving between the save message and the ack | frame-session state | unsaved = true from the moment of forwarding in all three cases; stays true after shim `dirty:false`; stays true after the ack (edit after the save message); a second own-file save with no later agent edit → false |
| E12 | Never silently lost (read-only) | EP | L1 | automated | `engine.execute` of a command marked read-only; `document.inspect`; `host.state` | forwarded and answered | unsaved stays false |
| E13 | Save outcomes readable | state-transition | L1 | automated | `saveSeq=4`; then save messages 5 (sibling dialog open), 5 resolves `sibling`, 6 `conflict`; separately no save message | `host.state{instance, sinceSeq:4}` at each step | `saves=[{seq:5,pending:true}]` → `[{5,false,sibling}]` → `[{5,…},{6,false,conflict}]`; no-save case → `saves:[]`, `noSaveYet:true` |
| E14 | Device downloads | BVA | L1 | automated | v3 control-enabled instance; save routed to a device download with `msSinceInput` 1999, 2000, 2001; same with a v2 frame; same on an app without `control` | host save routing | 1999 and 2000 download without a prompt; 2001 shows "The editor wants to download …"; v2 frame and non-control app never prompt |
| E15 | Untrusted replies (screenshot) | BVA | L1 | automated | screenshot PNGs: 4000×4000 (16 MP), 4001×4000, 2560×1600, and noisy 1280×800 content | host screenshot pipeline | 4001×4000 → refused before decode; others re-encoded JPEG q80 with long edge 1280, stepping to 960/640 until ≤ 192 KiB; when 640 still exceeds it → `reply_too_large` naming 640×400 |
| E16 | Pinned follow-ups | state-transition | L1 | automated | `instance` handle from an earlier reply; the instance then closes; separately the tab becomes inactive | `craft_control({instance, method:"engine.execute"…})` and `host.state` | no probe broadcast is sent; after close → `not-open`; inactive tab → mutation `not-visible`, `host.state` still answered |
| E17 | Shim relay | state-transition | L1 | automated | shim v3 with profile `control:{kind:"page-api", global:"fakecraft"}`; messages before `opened`, after `opened`, with wrong nonce, with `event.source` ≠ parent; global absent for 2 s; profile without `control` | host posts `control` | `not-ready`; relays `request` resolve/reject as `ok:true/false`; ignored; ignored; `unsupported` naming the expected version and "Settings → Update"; `unsupported` |
| E18 | Shim announces | EP | L1 | automated | shim v3 loads in a frame | `ready` sent | `ready` carries `shimVersion:3` and `control:true` (or `false` without a profile entry); `save` carries numeric `msSinceInput` |
| E19 | Opt-in per app (kill switch) | EP | L1 | automated | `plugins['craft-web'].liveControl=false` | tool request | `disabled`, no probe broadcast |
| E20 | Profile drift | decision-table | L1 | automated | profile table with `control` entries | `manifest.test.ts` | every `control` profile has `verifiedVersion` = registry `webVersion`, non-empty `allowedCommands`, read-only marks ⊆ `allowedCommands`, and no allowlisted command matches `/open\|import\|new\|close\|revert\|quit\|print\|url\|script\|macro\|batch/i`; frame profile contains only `{kind, global}` |
| E21 | Fixture gate | EP | L1 | automated | server start without `PI_DASHBOARD_FIXTURE_PLUGINS`; with it set to `1` | craft-web registers | without the flag no fakecraft mount, profile or claim exists; with it they do |
| E22 | Exactly one instance (two devices) | decision-table | L3 | automated | fakecraft doc open and visible in session S in two browser contexts; context A focused last | `craft_control` mutation | only A's document changes (`document.inspect` digest); B unchanged |
| E23 | Agent addresses by path (happy), per enabled app | EP | L3 | automated | each control-enabled app's e2e fixture document open and visible (VectorCraft: `logo.svg`); user selection made by a real click | `craft_control engine.execute` with the app's gate-recorded create command (VectorCraft: add a rectangle) | created object present in `document.inspect`; selection unchanged; no frame reload (`ready` count stays 1) |
| E24 | Agent addresses by path (not open) | EP | L3 | automated | session S with no editor on `report.docx` | `craft_control` | `not-open`; file sha unchanged |
| E26 | Opt-in per app (claim first) | decision-table | L1 | automated | profile tables: `control` on an app with an edit claim; on an app with no claim (FilmCraft before media projects, FigCraft); on a view-only claim | `profileErrors` | first valid; the other two report "control requires an edit claim" |
| E25 | Opt-in per app | EP | L3 | automated | WordCraft `report.docx` open (no `control`) | `craft_control` | `unsupported`; no `control` message reaches the frame (frame message log) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Exactly one instance (routed path) | tail-latency | L3 | automated | 50 sequential routed `engine.execute` echo requests to fakecraft, one browser context, docker harness | tool-call round trip p95 ≤ 600 ms | the 50 requests |
| P2 | Pinned follow-ups | tail-latency | L3 | automated | 50 sequential pinned (`instance`) echo requests to fakecraft | p95 ≤ 150 ms | the 50 requests |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Visible to the user | state-transition | L3 | automated | fakecraft doc; request using `sleep 1500` | `craft_control` | `craft-agent-active` chip visible with the method name during the call, gone after the reply; `craft-agent-log` gains one row with method, outcome, byte size and a ≤ 120-char preview |
| F2 | Visible to the user (log cap) | BVA | L1 | automated | 51 completed requests on one instance | log render | log shows 50 rows, oldest dropped |
| F3 | Stay theirs to undo | state-transition | L3 | automated | VectorCraft (gate go) `logo.svg`; agent adds a rectangle; no user edit after | user presses Cmd/Ctrl+Z in the frame | rectangle gone (`document.inspect`) |
| F4 | Agent input does not block the user | state-transition | L3 | automated | fakecraft request `sleep 3000` in flight | user types into the fakecraft text field during the request | typed text present after the request; request result `ok` |
| F5 | Run-time recheck | state-transition | L3 | automated | fakecraft doc visible; the probe is answered and, before the run arrives, the user switches the pane tab | run arrives | frame receives no `control` message; tool `not-visible` |
| F6 | Never silently lost (close guard) | state-transition | L3 | automated | fakecraft doc clean; agent mutation `ok` | user closes the tab | discard-confirmation dialog shown |
| F7 | Chip/log appearance | visual/subjective | — | manual-only | `craft-agent-active` chip and `craft-agent-log` in dark/light themes | human looks | [judgment: placement and legibility next to the existing toolbar chips] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Exactly one instance (forged reply) | fault-injection (abort) | L1 | automated | a second operate socket sends `control-result` with the right `reqId` and `instanceId` | router receives it before the real one | forged result dropped and logged; the claiming socket's result is the one returned |
| X2 | Exactly one instance (late reply) | fault-injection (delay) | L1 | automated | the claiming socket answers after the 13 s server TTL | router | tool already returned `timeout` ("outcome unknown"); late result dropped |
| X3 | Bounded (socket gone after run) | fault-injection (abort) | L1 | automated | the claiming socket closes after the run broadcast | router | `timeout` (outcome unknown), not `not-open` |
| X4 | Bounded (socket gone before run) | fault-injection (abort) | L1 | automated | the only claiming socket closes during the window | router | `not-open` |
| X5 | Run TTL | fault-injection (delay) | L1 | automated | run received by the client with `ttlMs=13000` but held 13 001 ms before handling (fake timers) | client registry | run dropped, nothing posted to the frame |
| X6 | Untrusted replies (malformed) | fault-injection | L1 | automated | frame answers `control-result` with `ok:"yes"`, with a cyclic `result`, with `result` as a function-like string > cap | host | tool error, malformed value not relayed |
| X7 | Bounded (timeout) | fault-injection (delay) | L3 | automated | fakecraft `sleep 12000` | `craft_control` | tool `timeout` with "may still have been applied"; tab reports unsaved |
| X8 | Device downloads (agent export) | fault-injection | L3 | automated | fakecraft export command that triggers an anchor download, no user input for > 2 s | `craft_control` | confirmation "The editor wants to download …" visible; Block → no download event in Playwright; Allow → one download |
| X9 | Device downloads (user export) | EP | L3 | automated | user clicks fakecraft's export button | click | download occurs with no confirmation |
| X10 | Save routing (conflict) | fault-injection | L3 | automated | fakecraft doc opened; the file is rewritten on disk with different bytes | agent save, then `host.state` | conflict dialog shown; file still has the external bytes; `host.state` lists the save with outcome `conflict` |
| X11 | Save routing (sibling, VectorCraft) | EP | L3 | automated | VectorCraft (gate go) `logo.svg` edited by the agent | agent save, user confirms "Create" | `logo.vectorcraft` exists; `logo.svg` sha unchanged; `host.state` lists `sibling`; tab still unsaved |
| X12 | Save routing (not performed) | EP | L3 | automated | fakecraft save that opens an in-app dialog | agent save, user cancels in-app | `host.state` → `noSaveYet:true`, `saves:[]` |
| X13 | Isolation unchanged | fault-injection | L3 | automated | fakecraft with control enabled runs `fetch("https://example.com")` and `fetch("/api/health")` from inside the frame | page load | both refused by CSP (violation reported via `csp`), as in the existing F5 row |
| X14 | Observe-only devices cannot claim | decision-table | L1 | automated | `craft-web/control-claim` and `craft-web/control-result` message types | `wsMessageTier(type)` | both resolve to `operate` (unlisted ⇒ operate), so an observe or control socket is rejected by the host gate |
| X15 | Tool availability | fault-injection | L1 | automated | `requestPluginServer` stub answering `{ok:false,error:"unavailable"}`, `"no_handler"`, `"request_too_large"`, `"timeout"` | bridge tool call | tool errors `unavailable`, `no_handler`, `request_too_large`, `timeout` (outcome unknown) with readable messages |
| X16 | Enablement gate, per enabled app | fault-injection | L3 | automated | each control-enabled app (VectorCraft from gate go): each read-only-marked command | run via `craft_control` | `document.inspect` digest identical before/after for every read-only command |

---

## Coverage summary

- Requirements covered: 10/10 (craft-live-control) + 1/1 (craft-web-editor delta, via X13, E17, E25)
- Scenarios by class: edge 26 · perf 2 · frontend 7 · error 16
- Scenarios by level: L1 31 · L3 19 · manual 1
- Scenarios by disposition: automated 50 · manual-only 1

## New infra needed

- fakecraft fixture app (static `index.html` + `window.fakecraft`) under the craft-web plugin, served only with `PI_DASHBOARD_FIXTURE_PLUGINS=1` (design D8). The docker harness must start with that flag for the L3 rows; `tests/e2e/plugin-embedded-app.spec.ts` shows the precedent.
- A test-side `craft_control` driver for L3: invoke the plugin request handler through a session bridge, as `tests/e2e/plugin-oauth-flow.spec.ts` drives plugin seams, or through a test-only route behind the fixture flag.
