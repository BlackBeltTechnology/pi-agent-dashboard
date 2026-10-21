# DOX — mockups/folder-card-pill-contrast

Explore-mode as-built vs proposed board: light-theme contrast of folder-card + session-card pills. Open `index.html`. No app code touched. Adopted from root `mockups/` by change `fix-folder-card-pill-contrast`. See change: fix-folder-card-pill-contrast.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. |
| `board.css` | Board chrome. Copied unchanged from `reorganize-session-header` board. |
| `icons.js` | `ICON` map generated from `@mdi/js` + `ic()` / `esc()`. |
| `index.html` | Board shell: theme seg (base/nord × dark/light), view seg, per-column probe lists, `DECISIONS` D1–D5. `window.__probeAllSurfaces()` → per-surface as-built/proposed failure counts. Query `theme`, `view`; hash = surface id. |
| `mockup.css` | Base reset, `.pill`, `.seg`. Copied unchanged. |
| `pills.css` | As-built replica = raw Tailwind v4 oklch palette (`--tw-*`, mockup-only) via `[data-tx]`/`[data-fill]`/`[data-bd]`; proposed recipes token-only: `.fab` banner, `.t-<hue>`, `.pg-*` glyph chips, `.tchip`, `.ta`, `.spin2`. |
| `probe.js` | `__probeRoot(el)`: text 4.5/3, size 11/12 px, plus WCAG 1.4.11 non-text 3:1 for svg + spinner arcs; colours resolved via canvas (oklch/color-mix safe). |
| `surfaces.js` | `SURFACES[]` S1 banner rungs, S2 SlotPill glyphs/markers (options A/B), S3 header pin + add-to-workspace, S4 phase rows/artifact letters/flow badge/toggle chips, S5 init stack. Fixtures from the reported screenshot + `worktree-init.ts` codes. |
| `tokens.css` | Generated from `packages/client/src/index.css` (`:root` + light) + nord dark/light from `THEMES`. Regenerate, do not hand-edit. |
| `ui-plan.md` | Root cause, surfaces→tokens→states, probe table (as-built 42/100/50/100 vs proposed 0), F15, decisions D1–D5. |
