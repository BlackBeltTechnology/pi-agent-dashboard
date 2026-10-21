# DOX — openspec/changes/improve-canvas-html-and-url-ux/mockups

As-built vs proposed static board for change `improve-canvas-html-and-url-ux`. Open `index.html`. No app code touched.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. See change: improve-canvas-html-and-url-ux. |
| `board.css` | Board chrome (toolbar, nav, shell, finds list). Copied from `align-ui-contract-recipes`, unchanged. See change: improve-canvas-html-and-url-ux. |
| `canvas.css` | Proposed component classes `c-*` (incl. `c-chip` confirm chip), `lv-*`, `eg` (source labels, shared-host line), `pk` (Clear all confirm row), `ac`, `ws`, `tabs`. Tokens only. One literal `#fff` on `--accent-solid`. See change: improve-canvas-html-and-url-ux. |
| `icons.js` | `ICON` map from `@mdi/js`. Copied plus 14 appended glyphs (Web, ServerNetwork, ShieldLockOutline, EyeOffOutline, ChatOutline, ...). See change: improve-canvas-html-and-url-ux. |
| `index.html` | Board shell. Title "Canvas HTML & URL UX: as-built vs proposed". Defines `renderSurface(id)`, theme/frame/view toolbar, probe badge. Query params `theme`, `width`, `view`. See change: improve-canvas-html-and-url-ux. |
| `mockup.css` | Base reset, `.pill`, `.seg`, `.p-btn`, `.p-input` recipes. Copied unchanged. See change: improve-canvas-html-and-url-ux. |
| `probe.js` | Contrast + size probe. `__probeAll()` returns per-surface proposed failures and as-built count. Patched: calls `renderSurface`, skips absent `RECIPES`. See change: improve-canvas-html-and-url-ux. |
| `surfaces.js` | `SURFACES[]` for S1 tool card (+ URL-declare confirm card and chip), S2 viewer header (Restricted pill, exposure and updated notices, no dev-server control), S3 egress banner (source-labelled rows, prompts-disabled state), S4 rendered page, S5 target picker (Clear all confirm), S6 access row, S7 composition. Realizes lists use exact spec requirement titles. As-built replicas inline-styled verbatim. Fake Fleetwise login page in `fleetDoc()`. See change: improve-canvas-html-and-url-ux. |
| `tokens.css` | Theme tokens (base dark, base light, nord dark). Copied unchanged. See change: improve-canvas-html-and-url-ux. |
| `ui-plan.md` | Mode preserve, profile product-ui, contract root `ui-contract.md`. File table, surface to token to state map, probe results, rubric, decisions (dev server removed, URL declares via confirm chip, runtime origins allow-once only, Restricted pill, Clear all confirm). See change: improve-canvas-html-and-url-ux. |
