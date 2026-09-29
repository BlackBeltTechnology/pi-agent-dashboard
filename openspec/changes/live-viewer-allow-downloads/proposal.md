# live-viewer-allow-downloads

## Why

`LiveServerViewer` embeds a user's local dev server in `sandbox="allow-scripts allow-forms allow-popups"`. That sandbox has no `allow-downloads`, so **Chrome drops any download the embedded app initiates — silently.** No download bar, no badge, no blocked-download icon in the address bar, no console error, no `error` event on the anchor.

Found in the field: `deck3d`'s configurator exports its tuning as a blob download. Viewed through the dashboard's live-server pane, pressing Export did nothing at all and wrote nothing to disk; the user reasonably reported it as "export is broken" in the deck, and the deck was not at fault. Any embedded app with a CSV/JSON/report export hits this, and the failure gives the user nothing to go on.

## What Changes

- Add `allow-downloads` to the `LiveServerViewer` iframe sandbox.
- Keep the D7 opaque-origin posture: `allow-same-origin` is deliberately NOT added, so the embedded app still cannot read the dashboard token or call `/api/*`. `allow-downloads` grants a download, not an origin.

## Impact

- `packages/client/src/components/editor-pane/LiveServerViewer.tsx` (one attribute).
- Threat delta: an embedded loopback app can now trigger a browser download. The user chose to run that server and to open it, and the browser still applies its own download UI and safe-browsing checks. This does NOT widen origin access.
- No server/extension change.

## Discipline Skills

- **`security-hardening`** — the change edits a sandbox attribute; the review must confirm `allow-same-origin` stays absent and that D7's documented isolation argument still holds verbatim.
- Not triggered: `performance-optimization`, `observability-instrumentation` (single attribute, no runtime path).
