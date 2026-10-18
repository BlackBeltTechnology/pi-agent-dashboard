## Why

The live spike on 2026-10-14 (Electron on one Mac, dashboard on another; record in `openspec/changes/add-operator-browser-relay/mockups/spike-remote-electron.md`) found four defects in the shipped browser relay. None of them depends on the remote topology.

- **Typing into the frame inserts nothing.** `BrowserPaneTab` forwards a `keyDown` with `{key, code}` only. CDP `Input.dispatchKeyEvent` inserts a character only when `text` is set. Proven live: `a`,`b` without `text` → `""`; `X`,`Y` with `text` → `"XY"`. Only the text-entry bridge works today.
- **A dialog connect loses its answer after 10 s.** The server's Fastify `connectionTimeout: 10_000` closes the request socket of `POST /api/browser/connect`. The relay keeps waiting up to 60 s and the extension may still attach, but the caller gets an empty reply (curl exit 52) and never receives the `cdpUrl`. The spec says "on Allow `connect` resolves", and a human Allow click routinely takes longer than 10 s. Zero-dialog connects (~4 s) hide the bug.
- **Pointer moves over the letterbox flood the audit log.** In Fit mode the frame box is larger than the image. Positions are normalized against the image, so pointer moves over the letterbox produce coordinates outside `[0,1]`, and the relay refuses and audits each one. The spike logged 124 `denied mouse` rows in ~4 min: noise in the Activity list that reads like an attack.
- **The idle strip blinks.** The relay reports `no-frames` after 2 s without a repaint. A static page stops repainting, so every cursor move flips the tab `live` ↔ `no-frames`. The pane shows or hides its idle strip on each flip, so the strip blinks and the frame jumps.

## What Changes

- **Printable keys carry `text`.** Frame `keyDown` for a single printable character sends `text` equal to the key, unless Meta or Ctrl is held. Ctrl together with Alt counts as AltGr, so those characters still get `text`. Enter sends `text: "\r"`. Other keys are unchanged. The relay allowlist is unchanged.
- **`POST /api/browser/connect` survives the full 60 s handshake window.** It disables the per-socket timeout for this request and restores it once the response finishes, the same pattern as `git-routes.ts` worktree init.
- **No pointer input from outside the image.** Pointer, wheel and click events produce no `browser_relay_input` while no frame image is rendered, or when their position falls outside it. The relay keeps refusing forged out-of-range input. Keys are unaffected: they need no geometry and stay gated by Input on and not detached.
- **Idle strip after 5 s.** The pane shows its idle strip only once the tab has stayed `no-frames` for 5 s, and hides it as soon as the tab reports any other state. The tab-label state dot keeps following the raw state.

Non-goals:
- Closing the extension's leftover `connect.html` tab.
- Recording the refusal reason in audit `detail`.
- Clipboard shortcuts (Cmd/Ctrl+C/V/A) inside the frame.
- IME composition inside the frame (the text bridge covers it).
- The pre-existing mismatch between the spec's `connect?profile=` query form and the handler's `profileDirectory` body. It is tracked as a follow-up.
- The UX redesign on the pending `openspec/changes/add-operator-browser-relay/mockups/` board.
- Controlled tabs detaching on pages with a password-manager frame (spike 2026-10-17, `Profile 21` with LastPass: `extension-closed:All controlled tabs detached`). Tracked by `add-dedicated-agent-browser`.
- That extension-caused detach missing from the audit, although the "Audit trail" requirement lists `detach`. Also tracked by `add-dedicated-agent-browser`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `browser-pane-tab`: idle indicator debounce; printable key `text`; no input outside the rendered frame.
- `browser-relay`: the connect response is delivered for a handshake that completes after 10 s.

## Impact

- `packages/browser-plugin/src/client/BrowserPaneTab.tsx`: `onKey`, `point`, idle strip.
- `packages/browser-plugin/src/server/routes.ts`: connect handler socket timeout.
- Tests in `packages/browser-plugin/src/client/__tests__/BrowserPaneTab.test.tsx` and `packages/browser-plugin/src/server/__tests__/routes.test.ts`.
- No protocol, config, or persistence change. Rollback = revert. Compatible with the existing relay: it already accepts `text` on `key` input (`viewer-input.ts` `keyCommands`).

## Discipline Skills

None apply. `security-hardening` is not triggered: the only untrusted-input boundary is the relay's viewer-input allowlist and validation (`viewer-input.ts`), and it is unchanged. The client-side `text` and the null-point drop only narrow what the trusted dashboard client sends. D2 holds a socket for at most the existing 60 s connect bound. No latency budget or new endpoint. `review-code` runs at the normal pre-commit checkpoint.
