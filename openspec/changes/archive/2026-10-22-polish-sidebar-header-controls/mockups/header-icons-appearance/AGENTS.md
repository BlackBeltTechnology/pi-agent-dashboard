# DOX — openspec/changes/polish-sidebar-header-controls/mockups/header-icons-appearance

Explore-mode board adopted into this change. Open `index.html` (serve the dir; no build). No app code touched.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. See change: polish-sidebar-header-controls. |
| `icons.js` | `ICON` map generated from `@mdi/js` + `mdiDiscordPath` (copied from `SessionList.tsx`). Regenerate, do not hand-edit. See change: polish-sidebar-header-controls. |
| `index.html` | Board: as-built vs proposed sidebar header. §0 as-built replica (`SessionList.tsx` row 1 + filter bar, `ThemePicker.tsx` 160 px dropdown, palette glyph 12 px `--text-muted`). §1 icon-button size A 24/14 · B 28/18 (chosen, left group `gap-1`) · C 32/18 (wraps at 280 px); each frame self-measures one-line fit + min glyph contrast at the slider width. §1b Appearance glyph candidates (`mdiBrightness6` chosen; `mdiCircleHalfFull` excluded — `GroupByChip` glyph). §1c collapsed connection chip: as-built dot+chevron vs A/B/C; C chosen = `mdiLaptop` local / `mdiServerNetwork` remote, `…Off` offline, dot as top-right corner badge, `--accent-red-text` offline glyph, "Offline" word from 480 px, no chevron below 400 px. Banner: `design.md` supersedes the board where they differ (D8). §2 live popover up to 300 px (Mode + Palette headings, labelled segmented mode, 2-col grid, split `--bg-primary`/`--accent-blue` swatch, selected-chip active look, no check glyph, `aria-pressed`). §3 keyboard / 220 px clamp / short viewport. §4 decisions D1–D6. Top bar: mode, 9 palettes, sidebar width, state toggles, `glyphSel`, `chipSel`. See change: polish-sidebar-header-controls. |
| `palettes.js` | `PALETTES` dark/light var maps generated from `packages/client/src/lib/theme/themes.ts` `THEMES`. Regenerate, do not hand-edit. See change: polish-sidebar-header-controls. |
| `probe.js` | Contrast + size probe (`window.__probeRoot`). Copied from group-servers-by-identity. See change: polish-sidebar-header-controls. |
| `tokens.css` | Theme tokens (base dark/light, nord dark). Copied from declutter-sidebar-header. See change: polish-sidebar-header-controls. |
