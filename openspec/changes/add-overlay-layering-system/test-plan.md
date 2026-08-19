# Test Plan — add-overlay-layering-system

Stage: proposal   Generated: 2026-08-19

Scenarios derived from `specs/overlay-layering/spec.md` (3 requirements). Stance: falsify the layering
invariant, not confirm it. No spec gaps — every Triple filled from the spec/design; no clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Named layer scale (ascending, unique) | BVA + parse | L1 | automated | the 8 `--z-*` declarations in `index.css` | parse file | all 8 declared; strictly ascending `base<raised<sidebar<overlay<popover<dialog<toast<lightbox`; `new Set(values).size === 8` |
| E2 | Matching `@utility` per layer | parse | L1 | automated | `@utility z-<name>` blocks in `index.css` | parse file | each of the 8 utilities exists and is bound to `var(--z-<name>)` |
| E3 | Ordering guarantees modal-over-menu | decision-table | L1 | automated | resolved token ints | compare | `dialog > popover` AND `toast > dialog` AND `lightbox > toast` (a `dialog` modal always outranks a `popover` menu by token, not DOM order) |
| E4 | Frozen baseline ratchet — add rejected | state-transition | L1 | automated | ratchet baseline of raw-z occurrences + a fixture file with ONE new `z-[123]` outside token utilities | run `z-layer-lint.mjs` | exit code ≠ 0; message names the new occurrence |
| E5 | Frozen baseline ratchet — shrink allowed | state-transition | L1 | automated | baseline where one allowlisted raw-z has been removed (portaled) | run `z-layer-lint.mjs` | exit code 0; baseline count decreased, never rejected for shrinking |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Box-escaping overlay portals (desktop) | state-transition | L1 | automated | `FolderActionsMenu` rendered desktop (`useMobile→false`), open | click trigger | panel is NOT contained by the trigger's wrapper `<span>` (portaled); `className` contains `z-popover` + `fixed`, NOT `absolute`/`z-50` |
| F2 | ALL forms portal (mobile + desktop) | state-transition | L1 | automated | `FolderActionsMenu` rendered with `useMobile→true` then `false`, open | click trigger | in BOTH forms the panel renders outside the trigger subtree (mobile via `DialogPortal`, desktop via `LayerPortal`) |
| F3 | Overlay paints above the sidebar content it overlaps (no underlap) | state-convergence | L3 | automated | dashboard folder header + body (subcards, buttons, `relative isolate` session card) | open the folder-actions menu (portaled panel drops over the folder body) | `document.elementFromPoint` at sampled points (25/50/75% height) inside the panel returns a node contained by `folder-actions-menu-panel-*` (panel topmost, nothing shows through); if the panel geometrically overlaps the isolate card, panel is topmost there too |
| F4 | Portaled `fixed` panel tracks trigger on ancestor scroll | state-convergence | L3 | automated | open folder-actions menu whose trigger sits in the scrollable sidebar list | scroll the sidebar list by ΔY=120px | after scroll, `|(panel.top − trigger.bottom) − 4| ≤ 3px` — panel stays anchored, does not detach |
| F5 | Visual smoke across breakpoints | subjective | — | manual-only | folder menu + a dialog + a toast + the lightbox | human views at 375 / 768 / 1440 | each overlay visibly paints above siblings; no clipped/underlapping surface [judgment — no automatable observable] |

---

## Coverage summary

- Requirements covered: 3/3 (layer-scale, portal-or-perish, no-underlap)
- Scenarios by class: edge 5 · perf 0 · frontend 5 · error 0
- Scenarios by level: L1 7 (E1–E5, F1, F2) · L2 0 · L3 2 (F3, F4) · manual-only 1 (F5)
- Scenarios by disposition: automated 9 · manual-only 1

## New infra needed

- none — L1 vitest (`packages/client/src/**/__tests__`), the `z-layer-lint.mjs` script test, and the
  existing docker Playwright harness (`tests/e2e/*.spec.ts`) cover every automated row.
