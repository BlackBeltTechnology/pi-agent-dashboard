## Context

See proposal.md — Why. The multi-select picker (`PathPicker.tsx` in `selection` mode, hosted by `AddFoldersDialog.tsx`) treats "the directory being browsed" and "a selectable item" as disjoint: only child rows carry a checkbox. `fetchedDirRef.current` already holds the resolved current-directory path, and `selection.onToggle(path)` already accumulates the caller's basket. The gap is purely presentational — there is no row for the current directory.

## Goals / Non-Goals

**Goals:**
- Make the currently-browsed directory selectable using the existing checkbox/basket contract, with zero new selection mechanism.
- Keep multi-tick of children unchanged; both flows share one basket and one commit.
- Read intuitively with minimal text, grounded in a documented list pattern.

**Non-Goals:**
- No change to pinning, workspace-destination, session badges, or MDI-only iconography requirements.
- No new props on `AddFoldersDialog` — the self path travels the existing `selection` contract.
- No single-select (`PathPicker` without `selection`) behavior change — the self-row is multi-select-only.

## Decisions

### D1: Self-row is a new `DisplayItem` variant, not a parallel control
Add `{ type: "self" }` to the `DisplayItem` union and render it first in `displayItems`, reusing the child checkbox wired to `selection.onToggle(<current-dir path>)`. **Why over a footer button / address-bar checkbox:** a second add-path (button, or a clickable address input) reads as a distinct mechanism and fragments the "tick to add" model users already learn from child rows. One grammar, one basket. Alternatives A–D were mocked (`mockups/self-row.html`); the grouped self-row (**D · v2**) won for lowest text + clearest hierarchy.

Keeping the self-row inside `displayItems` (index 0) means the existing ArrowUp/Down highlight traversal and the `scrollIntoView` query over `[role='option']` include it for free. `handleItemClick` and the Enter/Space branches gain a `type: "self"` case: **activation (click / Enter) toggles selection** (it must NOT call `descendInto`, since there is nowhere to descend), and **Space toggles** it too — today Space only toggles `item.type === "entry"` (`PathPicker.tsx` keydown branch), so that guard must widen to include `self`.

### D2: Inset-grouped-list treatment with a single `CONTENTS` eyebrow
The self-row sits accent-tinted at the top; one 10px uppercase muted `CONTENTS` label marks where browsing begins. **Source:** Apple HIG "inset grouped list" (section header above the group, muted, small — per the Prisma Design System spec) and the "headers live outside the list fill so groups read as separate" guidance (Berry, *Separating Content*). **Why over labelling both groups (D · v1):** the current row's tint + open-folder glyph already identify it, so a `THIS FOLDER` eyebrow is redundant text. One label, not two.

### D3: No chevron + open-folder glyph on the self-row
Children render `mdiChevronRight` as the descend affordance; the self-row omits it because the current directory cannot be descended into, and swaps `mdiFolder` → the open-folder glyph. **Why:** removes the only ambiguous affordance (a chevron would imply "go deeper into where I already am") and gives a one-glyph "you are here" cue. Tokens/MDI-only rule (existing requirement) is preserved.

### D4: Render-gate on a resolved current directory
The self-row renders only when `fetchedDirRef.current` is a **non-empty absolute path** (`result.current`, which is only assigned after a successful browse). Empty / relative / malformed values do not qualify. **Why:** during the initial default-directory fetch there is no self path yet; rendering a row with an empty/placeholder path would let the user basket a bogus path. Gating avoids a "select nothing" row.

### D5: Canonical comparison, not just shared `onToggle`
Two separate concerns: (a) the basket in `AddFoldersDialog.toggle()` normalizes paths (`normalizePath` + `inferPlatform`); (b) the picker's checkbox checked-state today reads `selection.selected.has(entry.path)` on the **raw** entry path (`PathPicker.tsx`). Reusing `onToggle` alone does NOT make the self-row's checked state agree with a normalized basket entry — the self path (`fetchedDirRef.current`, possibly trailing-separatored) and a child `entry.path` for the same dir could differ, showing an unchecked self-row for a directory that is in the basket, or double-counting. **Decision:** the self-row's checked-state test must apply the SAME comparison the basket already uses for child paths — `normalizePath` before `.has()` — so the self path (which may carry a trailing separator, e.g. a browsed root) and an equivalent child `entry.path` resolve to one entry and one checked state. **Scope caveat:** `normalizePath` collapses trailing-separator / `.` / `..` drift but *preserves case* (documented at `packages/shared/src/platform/paths.ts` — "Original case preserved (NO lowercasing)"), and the basket's child dedup already uses `normalizePath`. So this decision brings the self-row to PARITY with existing child behavior (trailing-separator collapse); it does NOT introduce case-insensitive dedup, which is a pre-existing basket behavior and explicitly out of scope. Covered by the trailing-separator "do not double-count" spec scenario.

### D6: Root directories get a non-empty pill label
`leafName()` in `AddFoldersDialog` strips all trailing separators, so `leafName('/')` / `leafName('C:\\')` / a UNC share root yields an empty string — an empty pill and an empty accessible remove label. **Decision:** when the stripped leaf is empty, fall back to the full path string for the pill label and its `aria-label`. **Why:** filesystem roots are legitimately addable (a user may browse to `/` and add it); an empty pill is unusable and fails the 1-item-label scenario.

### D7: `CONTENTS` label is presentational, outside the option set
The label is rendered between the self-row and `..` as a non-interactive element that is NOT a `role="option"`, is not in `displayItems`, and is not keyboard-focusable. **Why:** highlight traversal walks `displayItems` by index and `scrollIntoView` queries `[role='option']`; a label that entered either would offset the index and let ArrowDown land on a non-selectable row. Rendering it as a plain visual separator keeps DOM option order = `displayItems` order.

## Risks / Trade-offs

- [Self-row + `CONTENTS` label consume vertical space] → The list height is `rows * 32`; the self-row and label occupy roughly two rows, so one fewer child is visible before scrolling. Accepted — the list already scrolls and `rows` is a viewport hint, not a hard content count; no change to `rows`.
- [Self-row competes with `..` for the top slot] → The `CONTENTS` label sits *below* the self-row and *above* `..`, so `..` stays clearly inside the browsable group; the self-row is visually a different class (tint + open glyph + no chevron).
- [Drive-root / no-parent directories] → The gate (D4) is on the self path existing, independent of whether a parent exists; a root with a valid self path still gets a self-row, which is correct (you may want to add the root).
- [Double-count of current dir via self-row + child tick] → Mitigated by normalization parity (D5); covered by the coexistence scenario in the spec.
