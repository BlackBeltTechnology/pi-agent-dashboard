# Test Plan — fix-browser-relay-pane-input

Stage: design   Generated: 2026-10-14

Sources: proposal.md, design.md (D1–D4), specs/browser-pane-tab/spec.md, specs/browser-relay/spec.md.

Harness facts:
- Pane tests render `BrowserPaneTab` through `renderWithPlugin` with `FakeWs` (`packages/browser-plugin/src/client/__tests__/test-utils.tsx`).
- Image geometry is stubbed with `img.getBoundingClientRect = () => rect(...)`, as at `BrowserPaneTab.test.tsx:221`.
- Timers use `vi.useFakeTimers()`, as at `BrowserPaneTab.test.tsx:318`.
- Connect socket behaviour needs a REAL listen: `app.inject` cannot see `socket.timeout`. Build `Fastify({ connectionTimeout: 150 })`, `listen({port:0, host:"127.0.0.1"})` and `fetch`, as in `packages/server/src/access/__tests__/hold-request.test.ts`. 150 ms stands in for the production 10 s.

Harness exemplars (verified on disk):
- L1 pane ← `packages/browser-plugin/src/client/__tests__/BrowserPaneTab.test.tsx`: "wheel and key events are forwarded with normalized positions", "#F5", "#F8".
- L1 connect route ← `packages/browser-plugin/src/server/__tests__/routes.test.ts` (stub manager) + `packages/server/src/access/__tests__/hold-request.test.ts` (real-socket timeout pattern).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | DTI "Typing into the frame inserts text" | EP | L1 | automated | pane live, frame focused | keyDown + keyUp `a` (no modifiers) | 2 `browser_relay_input`: `{keyType:"keyDown", key:"a", text:"a"}` then `{keyType:"keyUp", key:"a"}` with no `text` property |
| E2 | DTI modifier rule (D1) | decision table | L1 | automated | frame focused | keyDown with (key, mods) ∈ {(`A`, shift), (`@`, ctrl+alt), (`´`, alt), (`a`, ctrl), (`a`, meta), (`a`, ctrl+meta+alt)} | `text` equals key for shift / ctrl+alt / alt; no `text` for ctrl / meta / ctrl+meta+alt |
| E3 | DTI single printable char only | EP | L1 | automated | frame focused | keyDown `key` ∈ {`ArrowLeft`, `Backspace`, `Dead`, `Process`, `Unidentified`, ` ` (Space), `é`} | no `text` for the first five; `text:" "` for Space, `text:"é"` for `é` |
| E4 | DTI Enter (D1) | decision table | L1 | automated | frame focused | keyDown `Enter` with mods ∈ {none, ctrl, meta, ctrl+alt} | `text:"\r"` for none and ctrl+alt; no `text` for ctrl and meta |
| E5 | DTI "Pointer over the letterbox" | BVA | L1 | automated | image rect `{left:100, top:50, width:400, height:200}` inside a 600×300 box | pointerup (mouse, button 0) at clientX ∈ {99, 100, 300, 500, 501}, clientY 150 | clicks sent only for 100 → `x:0`, 300 → `x:0.5`, 500 → `x:1`; nothing for 99 and 501 |
| E6 | DTI "Pointer over the letterbox" (move + wheel) | EP | L1 | automated | same rect | pointermove (mouse) and wheel at (50, 150) and (300, 150) | nothing at (50,150); one `mouse` move and one `scroll` at `x:0.5,y:0.5` for (300,150) |
| E7 | DTI "No image yet" | state-transition | L1 | automated | pane live, no frame received ("Waiting for frames…") | pointerup + wheel at box centre; then emit one frame and pointerup at image centre | zero inputs before the frame; exactly one `mouse` click `x:0.5,y:0.5` after |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | FRI "Static page stays visible" (5 s) | BVA | L1 | automated | frame rendered, fake timers | status → `no-frames`, advance 4999 ms, then 1 ms | `browser-pane-idle` absent at 4999 ms; present at 5000 ms; frame `<img>` still rendered |
| F2 | FRI "Brief repaint pause shows no indicator" | state-transition | L1 | automated | frame rendered, fake timers | `no-frames` 3000 ms → `live` → `no-frames` 3000 ms → `live` | `browser-pane-idle` never present; total `no-frames` time 6 s does not accumulate |
| F3 | FRI hide on any other state | state-transition | L1 | automated | strip shown (F1 reached) | status → `live`; repeat to strip shown, then status → `detached` (devtools) | strip absent in the same render as the status change in both cases; devtools text shown in the second |
| F4 | FRI re-arm | state-transition | L1 | automated | strip shown then `live` | status → `no-frames` again, advance 4999 ms | strip absent (timer restarted, not resumed) |
| F5 | #F5 regression (base "Static page stays visible") | regression | L1 | automated | existing test `#F5 no-frames keeps the last frame visible…` | switch it to fake timers and advance 5000 ms before the assertion | existing assertions hold: frame visible, idle strip + Bring to front, input still sent |
| F6 | FRI timer cleanup | state-transition | L1 | automated | `no-frames` pending (2 s elapsed) | unmount the pane tab, advance 5000 ms | no React state-update-on-unmounted warning (`console.error` spy not called) |
| F7 | Toolbar "Input toggled off" + D1 (regression) | regression | L1 | automated | Input off, frame focused | keyDown `a` | no `browser_relay_input` |
| F8 | idle debounce on a real relay | visual/subjective | — | manual-only | real Chrome tab in the pane, static page | move the cursor over the frame about every 2 s for 30 s | [judgment: idle strip never flashes, frame does not jump] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | CCL "Allow clicked after the server's idle connection timeout" | fault-injection (delay) | L1 | automated | `Fastify({connectionTimeout:150})`; stub `manager.connect` resolves `{ok:true, cdpUrl, instanceId}` after 450 ms | real `POST /api/browser/connect {profileDirectory:"Default"}` via `fetch` | HTTP 200 with that `cdpUrl`/`instanceId` (not a socket reset) |
| X2 | CCL 504 still delivered | fault-injection (delay) | L1 | automated | stub resolves `{ok:false, status:504}` after 450 ms | same request | HTTP 504 body delivered |
| X3 | CCL "restore that timeout once the response is sent" | state-transition | L1 | automated | same app; handler-side capture of `request.raw.socket` | request completes (X1) | captured socket `timeout === 150` after the response `finish`; during the await it was `0` |
| X4 | D2 guard: validation paths do not touch the socket | EP | L1 | automated | relay disabled (403) or missing `profileDirectory` (400) | real request | response code as before; captured socket `timeout` stays 150 throughout |
| X5 | D2 client abort | fault-injection (abort) | L1 | automated | stub resolves after 450 ms | `fetch` with `AbortController` aborted at 200 ms | stub `connect` still called once and settles; no unhandled rejection; server keeps serving the next request (200 on `GET /api/browser/status`) |
| X6 | real dialog connect | fault-injection (delay) | — | manual-only | real Chrome + Playwright extension, `zeroDialog` off | `POST /api/browser/connect`, click Allow after about 20 s | [judgment on a real extension: 200 with `cdpUrl` on the same request; `agent-browser connect` succeeds] |
| X7 | D1 risk: symbols and numpad via CDP | fault-injection (input shape) | — | manual-only | real relay tab focused on a text input | type `!@#` (Shift / AltGr on a Windows or Linux layout) and numpad `123` into the frame | [judgment on real Chrome: characters appear exactly once] |

---

## Coverage summary

- Requirements covered: 3/3 MODIFIED requirements (FRI = Frame rendering and idle state; DTI = Desktop and touch input; CCL = Connect and CDP-URL lifecycle), plus the Toolbar regression.
- Scenarios by class: edge 7 · perf 0 · frontend 8 · error 7.
- Scenarios by level: L1 19 · L2 0 · L3 0 · manual-only 3.
- Perf: none. No latency budget changes.
- New infra needed: none. The real-socket Fastify pattern already exists in `hold-request.test.ts`.
