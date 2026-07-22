## Context

Two approved, colocated redesigns (mockups in `mockups/`):

**A. Directory card** — rendered by `SessionList.renderGroup` (`packages/client/src/components/session/SessionList.tsx`). Today: a header row, a git row, then four plugin slot sections that each render a dense `LABEL (n) → ⟳ [action]` line — `FolderAutomationSection` (automation-plugin), `FolderGoalsSection` (goal-plugin), `FolderKbSection` (kb-plugin), `FolderOpenSpecSection` (client). Below them, `FolderSpawnButtons` renders `New Session` + `New Worktree` as full-width buttons *inside* the same bordered card. The slot sections are claimed via the `sidebar-folder-section` plugin slot; they own their own data hooks and navigation.

**B. Inline message/log surfaces** — four independently-styled components: `SpawnErrorBanner` (+ inner `TimeoutBanner`), `SessionBanner`, `MissingToolInlineError`, and the code-node log preview inside `FlowAgentCard` (flows-plugin). They diverge on radius, severity color source (`--severity-*` tokens vs raw `red-500/amber-500`), log treatment (`<details><pre>` vs prose vs fixed-3 truncated lines), icon, and dismiss glyph.

Constraints: 4 themes via CSS custom properties (theme-system skill); the folder slots live in separate plugin packages that must keep their data/nav logic; existing `data-testid`s and i18n keys must be preserved so tests/translations survive; the card renders once per folder (potentially many on screen) so watermark + animation cost matters (card-pulse paint budget).

## Goals / Non-Goals

**Goals:**
- Make each directory-card slot a single-concern, scannable pill; keep each slot's existing data hook + navigation intact (rendering-only change inside each `Folder*Section`).
- Add a faint 3D folder watermark centered behind the card, cheaply (a static SVG, no per-frame cost).
- Visually detach the spawn buttons into a `Create` tray that is not part of the card surface.
- Extract two shared client primitives — `InlineMessage` and `LogBlock` — and migrate all four inline surfaces onto them, deleting bespoke chrome and the duplicate `TimeoutBanner`.
- Preserve all observable behavior, controls, copy, `data-testid`s, and i18n keys.

**Non-Goals:**
- No change to spawn/retry/flow protocols, data hooks, server, or persistence.
- No new slot API; the `sidebar-folder-section` contract is unchanged (pills render *within* each section component).
- No redesign of the session cards themselves, the chat stream, or the flow graph — only the four named inline surfaces.
- No new theme tokens beyond a possible `--severity-info-*` if one is missing.

## Decisions

**D1 — Slot pills render inside each `Folder*Section`, not a new shared grid owner.**
Each plugin section keeps ownership of its data/nav and swaps its inner one-line markup for a shared pill. Alternative (a new `SlotPillGrid` in the client that reads all four data sources) was rejected: it would pull plugin data hooks into core and break the plugin-local boundary. To lay out four independently-rendered sections as a 2×2 grid, `renderGroup` wraps the `sidebar-folder-section` slot output + `FolderOpenSpecSection` in a `grid grid-cols-2` container (collapses to `grid-cols-1` below the sidebar breakpoint). The pill visual is a small shared presentational component (`SlotPill`) exported from the client and imported by each section, OR a documented className recipe — see Open Questions.

**D2 — Watermark is a static inline SVG asset, absolutely positioned, `pointer-events:none`, low opacity, behind `z-0`.**
The 3D look is baked into the vector (posterize→vtracer pipeline, `mockups/assets/folder-3d.svg`), so there is no CSS 3D transform and no runtime paint cost beyond one layer. The card gets `overflow:hidden` + a relative content layer at `z-1`. Alternative (CSS `rotateX/Y` on a flat icon) was rejected — it reads as a flattened blob and adds a transform layer.

**D3 — Detached spawn tray lives OUTSIDE the card element in `renderGroup`.**
`FolderSpawnButtons` moves from inside the bordered `.card` div to a sibling below it, wrapped with a `— CREATE —` divider label and no card border/shadow. The component keeps its props and `data-testid`s; only its container placement + button styling change.

**D4 — `InlineMessage` is one severity-parameterized component.**
Props: `severity: "error" | "warning" | "info"`, `icon`, `title`, `children` (sub/body), `actions` (pill buttons), `onDismiss`, plus `variant?: "compact"` (one-line, for missing-tool) and `animate?: boolean` (top accent-bar sweep, for in-flight retry). It reads `--severity-{severity}-{bg,border,fg}` tokens exclusively. `SpawnErrorBanner`, `TimeoutBanner`, `SessionBanner`, and `MissingToolInlineError` all become thin call sites; `TimeoutBanner` collapses into `SpawnErrorBanner` by passing `severity="warning"`.

**D5 — `LogBlock` is one monospace inset panel.**
Props: `label`, `text` (or lines), `collapsible?`, `defaultOpen?`, `maxHeight`. Renders a header (label · copy · collapse/expand chevron) + a `<pre>` body. Used by (a) spawn `stderr` (collapsible, closed by default) and (b) `FlowAgentCard` code-node log preview (a `preview` mode: last-N lines, `copy` + `expand`). This gives the flow preview copy/expand it lacks today and unifies the scroll/wrap behavior.

**D6 — Token discipline.** All severity colors come from `--severity-*`; raw `red-500/amber-500` in `SessionBanner` and `MissingToolInlineError` are removed. Radii unify to the card scale. Micro-labels bump from `--text-3` to `--text-2` (or ≥11px) to clear the AA contrast gap noted in review.

## Risks / Trade-offs

- **[Slot pill sharing couples plugins to a client export]** → If `SlotPill` is a client-exported component, each plugin package gains a client import of it; the plugins already import from `dashboard-plugin-runtime`, so export `SlotPill` from there (or ship it as a documented className recipe) to avoid a new cross-package dep. Resolve in Open Questions before coding.
- **[Grid layout with independently-mounted sections]** → sections render/hide on their own (e.g. automation hides until first load). A CSS grid tolerates a missing child, but a 2×2 can look lopsided at 1–3 slots. Mitigation: `grid-cols-2` with `auto-rows`, sections that render `null` simply leave a gap; verify the 1/2/3-slot cases visually.
- **[Moved controls break tests]** → `data-testid`s (`folder-spawn-session-btn`, `spawn-error-banner`, `error-banner-*`, etc.) are preserved; only container nesting changes. Update only assertions that target removed wrapper markup.
- **[Watermark contrast on 4 themes]** → a single taupe SVG may read too warm on dark/gradient themes. Mitigation: tint via low opacity + `currentColor`-style neutral, verify all 4 themes; regenerate a cooler variant if needed.
- **[Retry accent-bar animation cost across many cards]** → only one `SessionBanner` is mounted at a time (above the composer), so the sweep animation is single-instance; the folder watermark is static. Net paint cost is bounded; confirm with the perf pass (Discipline Skill).

## Migration Plan

Presentational refactor, no data migration.
1. Land `LogBlock` + `InlineMessage` primitives with their own tests (no call-site changes yet).
2. Migrate the four inline surfaces onto the primitives one at a time, updating tests per surface; delete `TimeoutBanner` and the bespoke styling.
3. Land the slot `SlotPill` + grid wrapper in `renderGroup`; migrate each `Folder*Section` render body.
4. Move `FolderSpawnButtons` to the detached tray; add the watermark asset + layer.
5. Rebuild client (`npm run build` + restart) per the implement skill; verify in an isolated env (frontend-mockup-loop-dashboard PROMOTE binding) across 4 themes × 3 breakpoints.
**Rollback:** revert the change; primitives and asset disappear; no residual state.

## Open Questions

- **Q1 — `SlotPill` delivery:** shared component exported from `dashboard-plugin-runtime`, a client component imported by plugins, or a documented Tailwind className recipe each section applies? (Leaning: export from `dashboard-plugin-runtime` so all four sections share one source without a new dep.)
- **Q2 — Watermark placement:** center on the whole card (current mock, sits over the git row) vs center on the pill-grid region only. (Leaning: pill-grid region, so it anchors the slots.)
- **Q3 — `--severity-info-*`:** confirm whether info tokens already exist in the theme layer or need adding (only needed if any surface uses the `info` severity in v1; none do today — likely defer).
