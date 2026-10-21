# UI plan: extend-craft-web-to-all-apps

Mockup: `index.html` + `mockup.css`. `tokens.css` and `probe.js` were copied from `harden-server-capability-bounds/mockups/` (generated from `packages/client/src/index.css`, base dark + light, Nord dark). Design Read profile `product-ui`; redesign mode `preserve`: no route, testid, shortcut or existing label changes. Image direction is off.

Ground (shipped sources):
- `craft-web-plugin/src/client/CraftFrame.tsx`: toolbar, notices, `SaveAsDialog`, fail panels.
- `craft-web-plugin/src/client/ui.ts`: `BTN`, `BTN_PRIMARY`, `NOTICE`, `PANEL`.
- `craft-web-plugin/src/client/CraftWebSettings.tsx`.
- `client/.../file-handler/FileModeSwitcher.tsx`.
- `client/.../file-handler/file-handler-host.ts`: core first-overwrite and conflict dialogs.
- `client-utils/src/Dialog.tsx`.
- `client/.../editor-pane/BinaryWarn.tsx`.

| Surface | Source today | States on the board | Tokens | Status |
|---|---|---|---|---|
| A Mode switcher | `FileModeSwitcher` | A1 type A, A2 type B, A3 binary dead end (as built), **A4 binary notice names the mode** | `--bg-selected`, `--text-tertiary`, `--border-primary` | A4 proposed (core `BinaryWarn`) |
| B Frame toolbar | `CraftFrame` `Toolbar` | B1 in place, **B2 "Save (Ctrl+S) creates photo.psd" chip + ".jpg exports" target label**, **B3 "View only" chip** | `--severity-info-*`, `--accent-soft` + `--text-primary` | B2/B3 proposed |
| C Unconfirmed open | design D4 plugin dialog + core first-overwrite notice | C1+C2 two dialogs (as designed), **C3 one core dialog with the check folded into the claim's `firstOverwriteNotice`** | core `Dialog` intents | C3 proposed (simplifies D4) |
| D Native-format save | design D6 | D1 Create and open, D2 no native claim, D3 409 too many copies | `BTN*`, `--severity-error-*` | as designed; copy refined |
| E Session-named save | `SaveAsDialog` | E1 as built, **E2 + reason sentence** | `BTN*` | E2 proposed (new message key) |
| G Settings | `CraftWebSettings` | G1 disabled selector (as designed), **G2 fixed channel as read-only fact + groups by app type + extensions + size on button** | settings kit, `--severity-*` pills | G2 proposed (spec wording change) |

Unchanged surfaces, not drawn: prepare gate (`craft-gate-*`), loading overlay, open-failed/start-failed/reloaded panels, too-large offer, navigate offer. New apps reuse them with their own labels.

Found while measuring: the shipped selected Save-target button (`text-[var(--accent-text)]` on `--accent-soft`, 12 px) measures 4.49:1 in base dark and Nord dark, below WCAG AA 4.5:1. Every board state uses `--text-primary` on `--accent-soft`, the pairing the token is documented for in `index.css`. Fix: one class in `CraftFrame.tsx`.

Checked:
- Computed-contrast probe (`probe.js`), 321 text nodes: 0 failures in base dark, base light and Nord dark, at both 375 px and 1280 px.
- No horizontal overflow; no console errors or warnings.
- `score_mockup` screenshots at 375, 768 and 1440 px read; dialogs reflow on mobile.

Not run: `validate_mockup` (the dashboard has no named-system preset).

Literal outside tokens: `var(--text-on-accent, white)`. It mirrors the shipped `text-white` on `--accent-solid`; the dashboard has no `--text-on-accent` token.
