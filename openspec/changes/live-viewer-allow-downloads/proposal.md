# live-viewer-allow-downloads

## Why

`LiveServerViewer` embeds a user's local dev server in `sandbox="allow-scripts allow-forms allow-popups"` (`packages/client/src/components/editor-pane/LiveServerViewer.tsx:141`). That sandbox has no `allow-downloads`, so **Chrome drops any download the embedded app initiates, and it does so silently.** There is no download bar, no badge, no blocked-download icon, no console error, and no `error` event on the anchor.

Found in the field: `deck3d`'s configurator exports its tuning as a blob download from a button click (`packages/deck3d/src/runtime/hud.ts`). Viewed through the live-server pane, pressing Export did nothing and wrote nothing to disk. The user reasonably reported "export is broken" in the deck, but the deck was not at fault. Any embedded app with a click-driven CSV/JSON/report export hits this.

## What Changes

- Add `allow-downloads` to the `LiveServerViewer` iframe sandbox. The full token set becomes `allow-scripts allow-forms allow-popups allow-downloads`.
- Keep the D7 opaque-origin posture. `allow-same-origin` is deliberately NOT added, so the embedded app still cannot read the dashboard token or call `/api/*`. `allow-downloads` grants a download, not an origin.
- Do not add `allow-downloads-without-user-activation`. Only downloads the user starts inside the frame (click/keypress) are permitted, and timer- or load-triggered downloads stay blocked.
- MODIFY the `live-server-preview` requirement "Embedded content SHALL be origin-isolated via sandbox". It currently pins `sandbox="allow-scripts"`, which already drifted from the shipped `allow-forms allow-popups`. The requirement now pins the exact token set.
- Sync the stale sandbox descriptions in live code and docs. Archived changes and `docs/research/` are immutable history and are left as-is. The places to update:
  - the `LiveServerViewer.tsx` module header (`:7`)
  - the inline D7 comment (`:139`)
  - the `live-server-proxy.ts` header (`packages/server/src/live-server/live-server-proxy.ts:5`, comment only)
  - the `LiveServerViewer.tsx` row in `packages/client/src/components/editor-pane/AGENTS.md`
  - the bundled `canvas-webapp` skill (`packages/extension/.pi/skills/canvas-webapp/SKILL.md:16,48,101`) and its `SKILL.md.AGENTS.md` row. Its self-verify harness claims to reproduce "the exact dashboard sandbox", so it must carry the 4-token set.

## Non-goals

- Downloads without user activation (`allow-downloads-without-user-activation`).
- Any proxy/CORS change. Blob downloads never touch the proxy, and `@fastify/reply-from` already passes upstream `Content-Disposition` through unchanged.
- Adding an Electron `will-download` handler. `packages/electron/src` has none. By Electron's documented default, an unhandled download prompts a save dialog; this is an assumption, confirmed by a manual check. A subframe `Content-Disposition` navigation does not go through `will-navigate` (`main.ts:514`), which fires for the main frame only.

## Impact

- Code: one attribute in `packages/client/src/components/editor-pane/LiveServerViewer.tsx`, plus comment and doc text. No server or extension behaviour change.
- Environments:
  - Chromium browsers (localhost and remote tunnel) honour `allow-downloads`. Firefox also enforces the token.
  - The Electron shell (`packages/electron/src/main.ts`) falls back to Electron's default save dialog. This is checked manually.
- Threat delta: an embedded loopback app can now make the browser save a file, but only from a user gesture inside the frame. Note that any click inside the frame counts as a gesture, not just a deliberate press of an export button. The target is allowlisted by host and port, not by content, so a different process later bound to a saved port gains this ability too. The download is still visible to the user and subject to the browser's own download UI and safe-browsing checks. Origin access is not widened.
- Rollback: remove the token. There is no persisted state and no migration.

## Discipline Skills

- **`security-hardening`**: the change edits a sandbox attribute. Review must confirm that `allow-same-origin` and `allow-downloads-without-user-activation` stay absent and that D7's isolation argument still holds.
- Not triggered: `performance-optimization` and `observability-instrumentation`. The change is a single attribute with no runtime path.
