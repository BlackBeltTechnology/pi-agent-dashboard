## Context

Evidence comes from the live spike of 2026-10-14 (`openspec/changes/add-operator-browser-relay/mockups/spike-remote-electron.md`, findings 2, 3, 6 and 7). Code as of `develop`:

- Frame keys: `onKey` sends `{kind:"key", keyType, key: e.key, code: e.code}` (`packages/browser-plugin/src/client/BrowserPaneTab.tsx:157-160`). The relay copies `text` only when present (`packages/browser-plugin/src/server/relay/viewer-input.ts:146`). The text bridge already sends `keyType:"char"` with `text` (`BrowserPaneTab.tsx:166`), and sends Enter as `keyDown` with `text:"\r"` (`BrowserPaneTab.tsx:171`).
- Positions: `point()` normalizes against `imgRef ?? boxRef` (`BrowserPaneTab.tsx:137-140`), and the handlers live on the frame box, which fills the pane in Fit mode (`BrowserPaneTab.tsx:254-268`). The relay refuses out-of-range coordinates and audits `denied` with the input kind (`viewer-input.ts:104`, `relay/screencast-tap.ts:274-286`).
- Idle: the relay flips a tab to `no-frames` after `NO_FRAMES_MS = 2000` ms (`relay/screencast-tap.ts:35`). The pane renders the idle strip whenever `tab.state === "no-frames"` (`BrowserPaneTab.tsx:209`, `:244`).
- Connect: `POST /api/browser/connect` awaits `manager.connect` (`packages/browser-plugin/src/server/routes.ts:222-244`). That call waits up to `CONNECT_TIMEOUT_MS = 60_000` (`relay/relay-manager.ts:36`, `:240-242`). The server sets `connectionTimeout: 10_000` (`packages/server/src/server.ts:1703`). The proven workaround: capture `socket.timeout`, `setTimeout(0)`, restore on `reply.raw` `finish` (`packages/server/src/routes/git-routes.ts:485-491`; `packages/server/src/access/hold-request.ts`).

## Goals / Non-Goals

**Goals:** typing into the frame works; a dialog connect returns its `cdpUrl` within the 60 s window; no input from outside the image; no idle-strip flicker on a static page.

**Non-Goals:** server audit detail format; leftover `connect.html` tab; clipboard shortcuts; IME composition in the frame (the text bridge covers it); any UX restyle (pending `openspec/changes/add-operator-browser-relay/mockups/` board).

## Decisions

### D1 — `text` is added client-side, only for printable keys

Define `isText(e)` as true when both hold:
- `[...e.key].length === 1`;
- `!e.metaKey && !(e.ctrlKey && !e.altKey)`.

The Ctrl exception is for AltGr. On Windows and Linux, AltGr reports `ctrlKey` and `altKey` together, so AltGr characters such as `@` and `€` on German layouts must still count as text.

On frame `keyDown`:
- when `isText(e)`, add `text: e.key` (Space included);
- Enter with neither Meta nor a non-AltGr Ctrl held sends `text: "
"`, matching the bridge.

`keyUp` never carries `text`. Dead keys (`"Dead"`), `"Unidentified"` and IME composition (`"Process"`) get no `text`. IME input stays on the text bridge (`BrowserPaneTab.tsx:164-167`); that is a non-goal here.

The server stays as it is: it already forwards `text`. Synthesizing `text` server-side would also fire for shortcuts that a client sends deliberately without it.

*Alternative rejected:* sending `keyType:"char"` in addition to `keyDown`. That doubles events, and CDP inserts text on `keyDown` with `text` anyway.

### D2 — socket timeout disabled per connect request, restored on finish

Copy the `git-routes` shape (`git-routes.ts:485-491`) into the plugin's connect handler:
- capture `socket.timeout`;
- call `setTimeout(0)`;
- only when the captured value is a number, restore it on `reply.raw.once("finish")` while the socket is not destroyed.

If the client aborts, `finish` never fires and the socket is destroyed, so there is nothing to restore. `manager.connect` still runs to its own 60 s bound, as it does today.

The plugin cannot import `packages/server/src/access/hold-request.ts`, because plugins depend only on `dashboard-plugin-runtime` and shared. So the six lines are duplicated, not shared. If a third user appears, the helper moves into `dashboard-plugin-runtime`.

The 60 s `connectTimeoutMs` stays the upper bound, so a socket is never held open without limit.

### D3 — input only from the rendered image

`point()` normalizes against `imgRef.current` only. It returns `null` in two cases:
- no image is rendered: waiting, `client-screencast-active`, or detached (`BrowserPaneTab.tsx:271`, `:281`);
- the normalized `x` or `y` is outside `[0,1]`.

Today it falls back to the frame box (`BrowserPaneTab.tsx:138`), so the relay refuses those events as `no-frame` (`viewer-input.ts:103`).

Every caller already drops a `null` point: mouse click, mouse move and wheel (`BrowserPaneTab.tsx:144-145,149-150,154-155`). Clicks on the letterbox are therefore ignored too. The user is aiming at nothing, so there is nothing to click.

The relay's refusal (`viewer-input.ts:103-104`) remains the security boundary for forged input.

### D4 — idle strip debounced 5 s on show, immediate on hide

`IDLE_NOTICE_DELAY_MS = 5000`, held in its own `useState` flag plus a timer effect. The timer starts when the tab enters `no-frames` and is cleared on any other state. The strip renders only after the timer fires.

The relay's 2 s `no-frames` state and the status broadcast stay unchanged, so the tab-label dot and other consumers still see the raw state.

From the last repaint the strip appears after about 7 s: the relay's 2 s plus the 5 s debounce. The spike suggested 10 s total; 7 s is chosen so a backgrounded tab still surfaces "Bring to front" quickly, while it still covers the normal pause between cursor moves.

## Risks / Trade-offs

- D1 platform heuristics:
  - Ctrl+Alt is read as AltGr, so a Ctrl+Alt accelerator that yields a printable `e.key` also inserts that character.
  - macOS Option+letter inserts the composed character (`´`, `Ω`). That is intended.
  - Shifted symbols and numpad digits rely on CDP inserting `text` without `windowsVirtualKeyCode`. The spike proved this only for letters, so a manual check is in the test plan.
  - Auto-repeat sends one `keyDown` with `text` per repeat. That is the same rate as today, now with text.
- D2 keep-alive reuse after a client abort can leave one socket at `setTimeout(0)`. This is the same as the `git-routes` template, and bounded to one socket.

- A page that really is idle now gets its Bring-to-front hint 3 s later. That's accepted: the frame stays visible either way.
- D3 hides letterbox clicks that the old relay refused anyway, so no behaviour is lost.
- D2 holds a socket for up to 60 s per pending connect. That's bounded by `RelayManager` and limited to one connect at a time per profile (`busy` 409).

## Migration Plan

Client + plugin server only. Rebuild client, restart server. Rollback = revert. No config/protocol change.
