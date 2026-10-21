# UI plan — folder-card pill contrast

Mode `preserve` · profile `product-ui` · no image direction. Trigger: user screenshot (base light) of the
retrust banner on `judo-esm-schema-merge-maven-plugin` — "Review & trust changes" unreadable.

## Root cause

Container surfaces paint through `--severity-*` / `--tint-*` (theme-aware). Controls and glyphs inside them
paint raw Tailwind palette `*-400` (dark-tuned). Light palettes keep the container readable and wash the
content out. Same pattern repo-wide: 510 light-tone `text-<hue>-200/300/400` hits; 1,211 raw-palette class hits
(any prefix/shade, guard SCAN_ROOTS) in 176 files.

## Surfaces → tokens → states

| Surface | Source | As-built paint | Proposed token | States |
|---|---|---|---|---|
| S1 Folder action banner | `FolderActionBanner.tsx`, `WorktreeInitButton.tsx`, `WorktreeInitChip.tsx` | `amber/green/red-400` chip/button inside severity box | icon + message + `border-current` action, all inherit `--severity-<sev>-fg` | retrust, init-needed, running, done, failed, setup (ref), compact chip |
| S2 Slot pills | `dashboard-plugin-runtime/src/SlotPill.tsx` (+ automation/mcp/kb/goal/team/openspec callers) | glyph `<hue>-400` on `<hue>-500/10`; markers `amber/red-400` | glyph `--accent-<hue>-text` on `--tint-<hue>-bg` (D3); markers `--accent-orange-text` / `--accent-red-text` | normal, neutral option, markers/errors |
| S3 Folder header | `SessionList.tsx` L2190, L1658 | pin `yellow-400`; add-to-workspace `blue-500` | `--accent-yellow-text`; neutral (per `folder-actions-menu`) | pinned, button |
| S4 Session-card activity + toggle chips | `OpenSpecActivityBadge.tsx`, `openspec-helpers.tsx`, `FlowActivityBadge.tsx`, `OpenSpecGroupPills.tsx`, `SessionList.tsx` L387/L2898 | 9 phase hues `*-400`; letters `green/yellow-500`; pressed chip `blue-400` | 6 hue `-text` tokens; pressed = `--tint-blue-{fg,bg,border}`; muted → `--text-secondary` | 5 phases, letters, 4 flow states, pressed/unpressed |
| S5 Worktree init stack | `WorktreeInitStack.tsx` | `amber/green/red-400`, `--text-muted` meta | `--accent-{blue,green,red}-text`, `--tint-red-bg/fg`, neutral Dismiss, `--text-secondary` meta | running, done, failed |

## Probe (board `probe.js`: text 4.5/3, size 11/12 px, NON-TEXT 3:1 for svg + spinner arcs)

| Theme | As-built failures | Proposed failures |
|---|---|---|
| Base dark | 42 | 0 |
| Base light | 100 | 0 |
| Nord dark | 50 | 0 |
| Nord light | 100 | 1 (D2 alternative row only — F15) |

Notable measurements (base light): retrust button 1.34:1 · running chip 1.31 · Retry 1.29 · failed chip 2.05 ·
KB glyph 1.58 · pin 1.57 · artifact letter `P` 2.12 · `Applying` 1.51. `--text-muted` task count `(4/12)`
fails in EVERY theme (2.0–2.6:1), and stack meta 1.67:1 in Nord dark.

## Out-of-scope finding

- **F15** `--severity-success-fg` on `--severity-success-bg` = 4.47:1 in Nord light. NOT a bug: inside the
  `message-severity-tokens` relative gate (3:1 floor; sub-AA cells are documented). A palette-wide resolver run
  (18 palettes) shows catppuccin / tokyo-night / rose-pine light triples at 2.7–4.4:1 — all within that gate.
  Consequence: banner content inherits the triple's guarantee (≥ 3:1 everywhere, AA in base), not a blanket AA.
- **F16** Palette-wide resolver: D3-A glyph (`--accent-<hue>-text` on `--tint-<hue>-bg`) ≥ 4.36:1 in all 18
  palettes; `--accent-<hue>-text` on `--bg-secondary` ≥ 4.5 in all 18; `--text-muted` on `--bg-secondary`
  1.78–3.77:1 (fails AA in all 18) → moves to `--text-secondary`.

## Decisions — approved by user (explore session); F15 not filed

Approved: D1, D2 (info), D3-A (B rejected), D4, D5.

- **D1** Banner hook rungs = icon + message + one `border-current` action (setup-rung template). New i18n keys
  `folders.bannerRetrust`, `folders.bannerInitNeeded`. `worktree-init-btn` testid + trust dialog unchanged.
- **D2** `done` stays on the info rung (recommended); success triple blocked by F15.
- **D3** Slot glyphs: A map `SlotAccent` keys onto 6 host hues (blue←blue/indigo, green←cyan/teal, purple, red) —
  recommended · B neutral glyph, hue only on error · C add indigo/cyan/teal tokens (54 palette values).
- **D4** Touched controls 10/11 → 12 px; slot unit/markers + stack mono 10/10.5 → 11 px.
- **D5** `rawPalette` ratchet arm in `scripts/theme-token-guard.mjs` (baseline = today's 1,211 hits / 399 `<file>::<hue>` sites in 176 files).
