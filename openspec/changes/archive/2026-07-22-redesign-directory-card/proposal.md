## Why

The **directory card** (folder group header in `SessionList.renderGroup`) packs four plugin slots into dense one-line text rows that each mix a label, count, state, and a right-floated action — hard to scan — while the `New Session` / `New Worktree` spawn buttons sit *inside* the card border, visually competing with the informational rows. Separately, the four surfaces that **inline a message or a log** (`SpawnErrorBanner`, `SessionBanner`, `MissingToolInlineError`, `FlowAgentCard` log preview) were each built in isolation: four radii, two color systems (`--severity-*` tokens vs raw `red-500/amber-500`), three different "show a log" treatments, and two dismiss glyphs. Both are approved redesigns (mockups under `mockups/`); this change lands them together because they share the card visual language and both reduce presentational drift.

## What Changes

**A. Directory-card redesign** (`mockups/directory-card.html`)
- Replace the four dense slot rows (AUTOMATIONS / GOALS / KB / OPENSPEC) with a 2×2 grid of **single-concern slot pills**: colored glyph · uppercase label · bold count · inline state (e.g. KB `⚠ 1 stale`) · one trailing action. OpenSpec's secondary `Archive`/`Specs` actions drop to a thin pill sub-row.
- Add a faint **3D half-open folder watermark** centered behind the card (low-color icon-style SVG in `mockups/assets/folder-3d.svg`, ~5 paths).
- **Detach the spawn buttons** from the card: `New Session` / `New Worktree` render below the card border as a `— CREATE —` action tray, not part of the informational card surface.
- Slot pill grid and Create tray collapse to a single column at narrow (sidebar/mobile) widths.

**B. Unify inline message/log primitives** (`mockups/inline-logs.html`)
- **NEW** `InlineMessage` component — severity accent bar + icon + title + sub + action-pills + `mdiClose` dismiss, driven entirely by `--severity-{error,warning,info}-*` tokens. Replaces the bespoke chrome of `SpawnErrorBanner`, `SessionBanner`, and `MissingToolInlineError` (compact one-line variant). Collapses the near-duplicate `SpawnErrorBanner` + `TimeoutBanner` into one severity-parameterized surface.
- **NEW** `LogBlock` component — one monospace inset panel with a labelled header, **copy**, and **collapse/expand**, consistent `max-height` + scroll. Reused by spawn `stderr` **and** the `FlowAgentCard` code-node log preview (which today truncates each line with no copy/expand).
- Migrate all four surfaces onto the two primitives; delete the per-surface ad-hoc styling and the duplicate timeout banner.

No behavioral/protocol changes to spawn, retry, or flow event handling — this is presentation + a shared-component refactor. Copy strings and `data-testid`s are preserved so existing tests and i18n keys keep working (adjusted only where a control moves).

## Capabilities

### New Capabilities
- `directory-card-layout`: the redesigned folder-group card — slot-pill grid, folder watermark, and detached Create tray, with responsive single-column collapse.
- `inline-message-log-primitives`: shared `InlineMessage` (severity-tokened) and `LogBlock` (labelled, copyable, collapsible) primitives and their contracts.

### Modified Capabilities
- `flow-card-status`: the code-node **Log preview** requirement changes — it now renders via `LogBlock` and gains copy + expand affordances (was fixed last-3 truncated lines, no copy/expand).
- `session-status-banner`: the error/retry surface requirement is restated in terms of the shared `InlineMessage` primitive (severity tokens + accent-bar retry animation) rather than bespoke `red-500` chrome; observable controls (Stop / Copy / dismiss, retry sub-line) are preserved.

## Impact

- **Client components**: `packages/client/src/components/session/SessionList.tsx` (`renderGroup`), `folder/FolderSpawnButtons.tsx`, `session/SpawnErrorBanner.tsx`, `session/SessionBanner.tsx`, `chat/MissingToolInlineError.tsx`; `packages/flows-plugin/src/client/FlowAgentCard.tsx`.
- **Plugin slot sections** (rendering only, no API change): `automation-plugin` `FolderAutomationSection`, `goal-plugin` `FolderGoalsSection`, `kb-plugin` `FolderKbSection`, `client` `FolderOpenSpecSection`.
- **New shared components**: `InlineMessage`, `LogBlock` (client primitives dir) + the folder-3d watermark asset.
- **Tokens**: reuse existing `--severity-*` theme tokens; add any missing `--severity-info-*` if absent. No new raw hex.
- **Tests**: component tests for `InlineMessage` (3 severities, compact variant, dismiss) and `LogBlock` (copy, collapse/expand, empty state); update existing `SpawnErrorBanner` / `SessionBanner` / `FolderSpawnButtons` tests for the moved chrome; visual/responsive check in both themes at 3 breakpoints.
- **No server / protocol / persistence impact.**

## Discipline Skills

- `code-simplification` — folding four divergent surfaces into two shared primitives (and merging the duplicate timeout banner) is a deliberate complexity-reduction pass.
- `review-code` — non-trivial multi-component change; review before commit.
- `performance-optimization` — the watermark SVG and the retry accent-bar animation render across many cards; verify no added paint/compositing cost per the card-pulse paint budget.
