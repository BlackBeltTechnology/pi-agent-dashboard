## 1. Frame keys carry text (D1)

- [x] 1.1 Test (see BrowserPaneTab.test.tsx "wheel and key events are forwarded with normalized positions"): pane live, frame focused · keyDown + keyUp `a` with no modifiers · keyDown carries `text:"a"`, keyUp has no `text` (test-plan #E1)
- [x] 1.2 Test (same exemplar): keyDown with (`A`,shift), (`@`,ctrl+alt), (`´`,alt), (`a`,ctrl), (`a`,meta), (`a`,ctrl+meta+alt) · `text` equals key for shift, ctrl+alt and alt; no `text` for ctrl, meta and ctrl+meta+alt (test-plan #E2)
- [x] 1.3 Test (same exemplar): keyDown `ArrowLeft`, `Backspace`, `Dead`, `Process`, `Unidentified`, Space, `é` · no `text` for the first five; `text:" "` and `text:"é"` for the last two (test-plan #E3)
- [x] 1.4 Test (same exemplar): keyDown `Enter` with none, ctrl, meta, ctrl+alt · `text:"\r"` for none and ctrl+alt; no `text` for ctrl and meta (test-plan #E4)
- [x] 1.5 Test (see BrowserPaneTab.test.tsx "#F7 Input off sends no input"): Input off, frame focused · keyDown `a` · no `browser_relay_input` (test-plan #F7)
- [x] 1.6 In `packages/browser-plugin/src/client/BrowserPaneTab.tsx` `onKey`, add `text` on `keyDown` when `[...e.key].length === 1`, `!metaKey` and `!(ctrlKey && !altKey)` (AltGr keeps text); Enter under the same rule sends `text: "\r"`; never on `keyUp`

## 2. Connect survives the idle connection timeout (D2)

- [x] 2.1 Test (see packages/server/src/access/__tests__/hold-request.test.ts for the real-socket pattern, and routes.test.ts for the stub manager): `Fastify({connectionTimeout:150})` listening on port 0, stub `manager.connect` resolves ok after 450 ms · real `POST /api/browser/connect` via fetch · HTTP 200 with that `cdpUrl`/`instanceId` (test-plan #X1)
- [x] 2.2 Test (same exemplars): stub resolves `{ok:false,status:504}` after 450 ms · same request · HTTP 504 body delivered (test-plan #X2)
- [x] 2.3 Test (same exemplars): handler-side capture of `request.raw.socket` · request of 2.1 completes · socket `timeout` was 0 during the await and is 150 after `finish` (test-plan #X3)
- [x] 2.4 Test (same exemplars): relay disabled (403) and missing `profileDirectory` (400) · real request · codes unchanged and socket `timeout` stays 150 throughout (test-plan #X4)
- [x] 2.5 Test (same exemplars): stub resolves after 450 ms · fetch aborted at 200 ms · stub `connect` called once and settles, no unhandled rejection, next `GET /api/browser/status` returns 200 (test-plan #X5)
- [x] 2.6 In `packages/browser-plugin/src/server/routes.ts` `POST /api/browser/connect`, after validation capture `request.raw.socket.timeout`, call `setTimeout(0)` before `manager.connect`, and — only when the captured value is a number — restore it on `reply.raw.once("finish")` when the socket is not destroyed (shape of `packages/server/src/routes/git-routes.ts:485-491`)

## 3. No pointer input outside the image (D3)

- [x] 3.1 Test (see BrowserPaneTab.test.tsx "#F8 a centre tap is one click", rect stub at :221): image rect `{left:100,top:50,width:400,height:200}` · mouse pointerup at clientX 99/100/300/500/501, clientY 150 · clicks only at 100→x:0, 300→x:0.5, 500→x:1; none at 99 and 501 (test-plan #E5)
- [x] 3.2 Test (same exemplar): same rect · pointermove and wheel at (50,150) and (300,150) · nothing at (50,150); one `mouse` move and one `scroll` at x:0.5,y:0.5 for (300,150) (test-plan #E6)
- [x] 3.3 Test (same exemplar): pane live, no frame yet · pointerup + wheel at box centre, then one frame and pointerup at image centre · zero inputs before the frame, one `mouse` click x:0.5,y:0.5 after (test-plan #E7)
- [x] 3.4 In `BrowserPaneTab.tsx` `point()`, normalize against `imgRef.current` only (no box fallback) and return `null` when no image is rendered or the normalized `x`/`y` is outside `[0,1]`

## 4. Idle strip debounce (D4)

- [x] 4.1 Test (see BrowserPaneTab.test.tsx "#F5", fake timers as at :318): frame rendered · status `no-frames`, advance 4999 ms then 1 ms · `browser-pane-idle` absent at 4999 ms, present at 5000 ms, frame still rendered (test-plan #F1)
- [x] 4.2 Test (same exemplar): `no-frames` 3000 ms → `live` → `no-frames` 3000 ms → `live` · `browser-pane-idle` never present (test-plan #F2)
- [x] 4.3 Test (same exemplar): strip shown · status `live`; again to shown, then `detached` (devtools) · strip gone in the same render both times; devtools text shown in the second (test-plan #F3)
- [x] 4.4 Test (same exemplar): strip shown then `live` · `no-frames` again, advance 4999 ms · strip absent (test-plan #F4)
- [x] 4.5 Update existing test "#F5 no-frames keeps the last frame visible…" to use fake timers and advance 5000 ms before its assertions · existing assertions still hold (test-plan #F5)
- [x] 4.6 Test (same exemplar): `no-frames` pending 2 s · unmount, advance 5000 ms · `console.error` spy not called (test-plan #F6)
- [x] 4.7 In `BrowserPaneTab.tsx`, add `IDLE_NOTICE_DELAY_MS = 5000` with its own state flag + timer effect; render the idle strip only after `no-frames` has persisted that long; clear the timer on any other state and on unmount

## 5. Manual verification (post-merge)

- [x] 5.1 Real Chrome tab in the pane, static page, cursor moved over the frame about every 2 s for 30 s: the idle strip never flashes and the frame does not jump (test-plan: manual-only, #F8)
- [x] 5.2 Real Chrome + Playwright extension with `zeroDialog` off: `POST /api/browser/connect`, click Allow after about 20 s, get 200 with `cdpUrl` on the same request, and `agent-browser connect` succeeds (test-plan: manual-only, #X6)
- [x] 5.3 Real relay tab focused on a text input: type `!@#` (Shift, and AltGr on a Windows or Linux layout) and numpad `123` into the frame; each character appears exactly once (test-plan: manual-only, #X7)

## 6. Docs + closeout

- [x] 6.1 Update the `BrowserPaneTab.tsx` row in `packages/browser-plugin/src/client/AGENTS.md` and the `routes.ts` row in `packages/browser-plugin/src/server/AGENTS.md` with `See change: fix-browser-relay-pane-input`
- [x] 6.2 Run `set -o pipefail; npx vitest run packages/browser-plugin 2>&1 | tee /tmp/pi-test.log`, then rebuild the client (`npm run build`) and restart the server (`POST /api/restart`); confirm `/api/health` `mode`
