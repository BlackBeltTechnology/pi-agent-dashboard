# Audit — fix-slot-pill-legend-and-stale-overflow

Board: `slot-pill-legend-stale.html` (index.html redirects). Tokens: `tokens.css`, generated from
`packages/client/src/index.css` (`:root`, `[data-theme=light]`) + `THEMES` nord.dark (`themes.ts`).
Icons: `icons.js`, generated from `@mdi/js`. No runtime fetch.

## Live as-built evidence (localhost:8000, develop, production build, 2026-10-14)

Captured with Playwright at 1440 px, session open (narrow sidebar), DPR 2 → `asbuilt/*.png`.

| Surface | Measure | Value |
|---|---|---|
| Sidebar KB pill (Documents, 60,360 / 39 stale) | SlotPill root width | 202.5 px |
| same | stale badge right edge past pill border | **+14.7 px** |
| Sidebar KB pill (pi-agent-dashboard, 38,050 / 92 stale) | same | **+14.4 px** |
| Sidebar KB pill (bosch, 4,249 / 5 stale) | same | −1.6 px (fits) |
| Worktree session card legends | capsule height | 16.0 px (all) |
| same | legend → panel above | −1.0 px (1 px clear) for subcards |
| same | MCP claim legend → KB row above (card slot, no gap between claims) | **+5.0 px into it** |
| same | legend bottom → own content top | OPENSPEC 0, KB 0, MCP 0, GIT **−2**, PROCESS **−4** px |

New finding (not in the planned design): `WorktreeCardSectionSlot` renders its claims as a bare
fragment inside the `mt-1.5` wrapper (`SessionCard.tsx:1490`, `slot-consumers.tsx:181-186`), so
consecutive card-slot claims (KB, MCP) stack with zero gap. Proposed: wrapper
`mt-2.5 flex flex-col gap-2.5`.

## Replica fidelity

As-built replica reproduces the live numbers within 1 px: pill 201.5 px (live 202.5), stale
overflow +15.4 px for 92 stale (live +14.4), MCP legend +5.0 px into the KB row (live +5.0).
Grid uses `repeat(2, minmax(0, 1fr))` (Tailwind v4 `grid-cols-2`).

## Probe results (`computed-contrast.ts` measureText / contrastFailures / sizeFailures /
buttonsWithoutFocusIndicator + geometry: stale ⊂ pill, number untruncated, legend clear of own
content and of the panel above)

3 themes (base dark, base light, nord dark) × 3 widths (1440 / 768 / 375) × 3 surfaces.

| Column | Failures |
|---|---|
| As-built | 54 — stale overflow (+15.4 / +35.5 px at 1440; +47.9 / +68.0 px at 768), MCP legend 5 px into KB row, OPENSPEC/GIT/PROCESS legends 4 px onto content |
| **Proposed** | **0** |

Console: no errors. Board screenshots: `after/board-*.png`.

Note: the 375 px card frame is illustrative only — below 768 px `useMobile` renders the mobile
session card, which has no KB slot.

## Approval (2026-10-14, ask_user batch)

- Legend 11 px uppercase, `tracking-wide`, `-top-2` — **approved as shown**.
- Stale marker: `mdiAlertOutline` + count; "N stale" as title + sr-only — **approved as shown**.
- Under width pressure the `chunks` unit ellipsizes (`60,360 c…`), number never truncates — **approved**.
- New finding folded: worktree card-slot wrapper `mt-2.5 flex flex-col gap-2.5` — **approved**.
