# UI plan — Skill Atlas (plugin)

Per-change scope of root `ui-contract.md`. Tokens only; values live in `packages/client/src/index.css` + `themes.ts`.
Mockup: `index.html` (+ `tokens.css` generated from `index.css`/`themes.ts`, `data.js` = real 91-skill snapshot).
Design Read profile: `product-ui`. Redesign mode: `preserve` (Skills grid unchanged; atlas additive). Image direction: off.

## Surfaces → tokens → states

### S1 · Skills-page section (`resource-page-section`, Folder + Global Skills pages)

Compact summary above the existing grid. Never replaces the grid.

| Element | Recipe |
|---|---|
| container | inset panel `rounded-lg bg-[var(--bg-tertiary)] border-[var(--border-subtle)]` |
| heading "Skill Atlas" | section heading `text-[12px] font-semibold text-[var(--text-secondary)]` |
| stats line | `text-[12px] text-[var(--text-secondary)]`: "91 skills · 169 links" |
| relation mini-legend | line glyph (solid/dashed/dotted) + word + count; glyph uses `--accent-*` fill, word `--text-secondary` |
| most-connected chips | chip `rounded-full bg-[var(--bg-secondary)] text-[11px]`, top 5 by degree, each opens atlas focused on that skill |
| "Open atlas" | secondary button (one primary per view = page's own; atlas link is secondary) |

States: loading (skeleton line, `aria-busy`), empty (hidden entirely — no empty chrome on a resource page), degraded (one-line warning callout), error (inline `--severity-error-*` text + Retry).

### S2 · Atlas page (`shell-overlay-route`, `presentation:"content"`)

Project: `/folder/:encodedCwd/atlas/*?` (depth 2, Back → folder). Global: `/atlas/*?` (depth 1).

| Region | Recipe |
|---|---|
| header | title `text-lg`; scope label pill ("Project · pi-agent-dashboard" / "Global"); freshness status (dot `--status-idle`/`--status-working` **+ text** "Up to date" / "Updating…") |
| toolbar | search input (contract input); view tabs Cards / Graph / Links (WAI-ARIA tabs); relation toggles = checkbox chips w/ line glyph; origin filter = checkbox chips Project / Global / Package |
| Cards | card root recipe, grouped by origin → package; group heading = section heading + count |
| Graph | SVG on `--bg-primary`; nodes: shape encodes origin (◆ project, ● global loose, ■ package), fill `--bg-secondary`, stroke `--border-strong`; project nodes get `--accent-green` ring; selected `--focus-ring` ring. Edges = series colours `--accent-blue` (references, solid + arrow), `--accent-purple` (bundle, dashed), `--accent-orange` (shares-tool, dotted). Labels `--text-secondary` 11px, shown for selected / focused / high-degree nodes only |
| zoom controls | icon-only buttons `min-w-[44px] sm:min-w-[32px]`, `aria-label` |
| detail panel | card recipe, right column `w-80` ≥ lg; below lg = full-width panel under toolbar (mobile: MobileShell detail depth). Shows id, description (escaped text), path (mono, `--text-secondary`), origin + package pills, neighbours grouped by relation with "why" line, Focus 1-hop / 2-hop segmented control, "Open SKILL.md" secondary button |
| Links tab | `<table>` adjacency list (source, relation, target, why) — accessible equivalent of graph |

States: loading (skeleton cards), empty ("No skills load in this folder" + link to Skills page), degraded (warning callout: scan fell back to directory walk), rebuilding (keep stale view, header status "Updating…"), stale-push (rebuild arrives → in-place update, selection preserved), >300 nodes (Graph tab `aria-disabled` + info callout, Cards/Links still work), error (severity-error callout + Retry).

### S3 · Entry points (no new surface)

- Folder actions menu item "Skill Atlas" (group `open`, mdi graph-outline icon) → S2 project.
- Settings nav hint "Skill Atlas" (group Resources) → S2 global. `command-route` `/atlas` → S2 global.

## Decisions + cited rules

| Decision | Rule (source) |
|---|---|
| Summary on Skills page, full graph one click away | Progressive disclosure (nngroup.com/articles/progressive-disclosure) |
| Graph never sole channel: Cards + Links table carry same data | WCAG 1.1.1 / 1.3.1; graph = non-text content needs text equivalent |
| Relation type = colour **+** line style **+** word | WCAG 1.4.1 Use of Color; ui-contract a11y invariant 4 |
| Origin = node shape + ring, not hue alone | WCAG 1.4.1; Gestalt similarity (lawsofux.com/law-of-similarity) |
| Edge/ring fills ≥ 3:1 vs `--bg-primary` | WCAG 1.4.11 Non-text Contrast |
| Labels only for selected/focused/top-degree | Cognitive load / Miller (lawsofux.com/millers-law); Tesler — complexity in system |
| Selecting node opens detail, list of 1-hop neighbours clickable | Recognition over recall (Nielsen #6) |
| Freshness status text in header; stale view kept during rebuild | Visibility of system status (Nielsen #1); no blocking spinner (Doherty threshold, lawsofux.com/doherty-threshold) |
| Tabs follow APG tabs pattern (arrow keys, `aria-selected`) | WAI-ARIA APG Tabs (w3.org/WAI/ARIA/apg/patterns/tabs) |
| Zoom/focus controls ≥ 44px below `sm` | WCAG 2.5.8 + Fitts's Law (lawsofux.com/fittss-law) |
| Deterministic layout, no animation tick | `prefers-reduced-motion`; consistency & standards (Nielsen #4) — same graph each open |
| Search filters dims non-matching instead of removing nodes | Preserve spatial memory (Nielsen #6) |
| Exactly one primary action per view (none on graph page; "Open SKILL.md" is secondary) | ui-contract anti-slop: one focal point (Von Restorff) |

## New tokens

None. Graph series use raw `--accent-*` (contract: "Raw accents are reserved for the status family and for chart/graph series").

## Known debt not copied

`ResourceCard.tsx` pills use Tailwind palette classes (`bg-blue-500/10`, `bg-green-500/12`, fallback hex). Atlas uses tint triples instead.

## TEST results (loop rounds 1–6)

Live: `serve_mockup` on `mockups/` → `index.html?surface=skills|project|global|states&theme=dark|base…&sel=<id>&hops=0|1|2&view=cards|graph|links`.

axe-core (WCAG 2.0/2.1/2.2 A+AA), 7 surface states × 4 palettes (base/nord × dark/light) × 2 widths (375, 1440) = 56 pages:

| Palette | Violations |
|---|---|
| base dark, base light, nord dark | **0** |
| nord light | `color-contrast` only. Two token pairs: `--link` on `--bg-primary` 3.49:1, `--tint-green-fg` on `--tint-green-bg` 4.44:1 |

The nord-light failures are **pre-existing palette debt** in `themes.ts` (`nordLight["--link"]`). `--link` is already used by 6 shipped components, and no contrast test covers it. Atlas keeps the contract recipes. Follow-up: a separate fix in `themes.ts` plus a `--link` row in `theme-body-text-contrast.test.ts`.

`index.html`: 0 colour literals. All colour is `var(--…)`. `tokens.css` is a generated copy of the theme layer (excluded per adapter rule).

| Rubric | Result |
|---|---|
| Contrast AA (dark + light) | PASS. Base both modes plus nord dark. Nord light fails only on pre-existing palette debt (above). |
| Responsive / targets | PASS. 44px below `sm` (chips, tabs, seg, hubs, zoom, nb rows); filters collapse below `sm` |
| Hierarchy | PASS. Graph is the focal point; one secondary action per panel; no primary button on the atlas page |
| Spacing | PASS. Steps 4/6/8/12/16 only |
| Token fidelity | PASS |
| Anti-slop | PASS. Real skill ids and paths; no gradient or hero; system font stack as in shipped client |
| Console | PASS. 0 errors on 56 pages |

### Defects found → fixed

| # | Sev | Defect | Fix → spec implication |
|---|---|---|---|
| 1 | 3 | Isolated nodes stretch the extent, so nodes become dots and labels can't be read | Pixel-space render (no viewBox scaling); stronger gravity on degree-0 nodes |
| 2 | 3 | Focus mode keeps the full-graph fit, so the focus set is tiny | **Focus re-fits the view to the k-hop set** |
| 3 | 2 | Bundle cliques collapse and labels overlap | Weak bundle spring; **greedy label placement** by priority (selected > neighbours > search hit > keyboard cursor > top-10 degree), skip on overlap, labels in a top layer |
| 4 | 3 | Filter toolbar fills the first mobile screen | Filters collapse to a "Filters · N on" disclosure below `sm` |
| 5 | 3 | Dimmed cards/rows fail 1.4.3 | **Cards/Links hide non-matching items** and show a "Showing N of M · Clear" status; only the graph dims (shapes) |
| 6 | 2 | Detail panel below 91 cards on mobile | Detail first below `lg` (real impl: MobileShell depth panel) |
| 7 | 1 | Mutual references listed twice (→ and ←) | **Merge into one `↔` row** |
| 8 | 1 | Descriptions cut mid-word | Word-boundary truncation + ellipsis |
