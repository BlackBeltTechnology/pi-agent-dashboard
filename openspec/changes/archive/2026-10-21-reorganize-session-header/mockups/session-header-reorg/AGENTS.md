# DOX — openspec/changes/reorganize-session-header/mockups/session-header-reorg

As-built vs proposed static board for the session chat header (`SessionHeader.tsx`) and the composer-strip refresh. Open `index.html`. No app code touched. Adopted from root `mockups/` by change `reorganize-session-header`. See change: reorganize-session-header.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. |
| `asbuilt/` | Live :8000 PNG crops (2026-10-21, base light): `desktop-chat.png`, `desktop-split.png` (1,600 × 900), `narrow-long-title.png` (1,100 × 800, title swapped in DOM to a 66-char name), `context-row.png`, `mobile-header.png` + `mobile-composer.png` (390 × 844), `composer-strip.png`, `icon-collisions.png` (Seek / Focus / Goals / both refresh glyphs, 4×). |
| `board.css` | Board chrome (toolbar, nav, shell, finds list). Copied unchanged from `improve-canvas-html-and-url-ux`. |
| `header.css` | Proposed recipes, tokens only: `.sh` desktop header (container query at 760 px), `.lsw` segmented radiogroup (tint-blue selected), `.ltabs` tab-styled variant, `.menu` flyout, `.mh` mobile header, `.ring` context ring (composer-dock geometry, WCAG 1.4.11 tokens: track `--border-secondary`, hot `--accent-orange-text`), `.dockref` composer reference strip, stage placeholders. |
| `icons.js` | `ICON` map generated from `@mdi/js` + `ic()` / `esc()` helpers. |
| `index.html` | Board shell. `renderSurface(id)`, theme + view toolbar, probe badge. Query params `theme`, `view`; hash = surface id. |
| `mockup.css` | Base reset, `.pill`, `.seg` recipes. Copied unchanged. |
| `probe.js` | Contrast + size probe (`__probeRoot`, `__probeAll`). Copied unchanged. Board badge probes `.col.prop .stage`. |
| `surfaces.js` | `SURFACES[]`: S1 desktop (approved A: right switch + View + seek icon, title menu, ended, warning; B, C for comparison), S2 context bar → ring (approved R2: header meta-line ring, 85%, 560 px, mobile ring button; R1 composer ring for comparison), S3 narrow 560 px (incl. long title), S4 mobile 390 px (icon menu), S5 icon meanings. Composer-side items are referenced, owned by `mockups/composer-dock`. Fixtures from the live session (`Reorganize header`, pi 1.3.0, +1 −26 · 1, 127.0k / 1.0M). |
| `tokens.css` | Generated 2026-10-21 from `packages/client/src/index.css` (`:root` + light) + nord dark from `THEMES`. Regenerate, do not hand-edit. |
| `ui-plan.md` | Mode preserve, profile product-ui; surfaces → tokens → states; decisions D1–D10 with approval status; cross-board dependencies on `mockups/composer-dock`; probe results. |
