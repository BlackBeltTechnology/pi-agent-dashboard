## Context

The Instructions page (`InstructionsPage.tsx` + `FilePicker.tsx`) is a
two-column split: a scoped `.md` file picker on the left, a Monaco editor on the
right. The picker fetches writable candidates from
`GET /api/file/md-candidates` and renders each `candidate.relPath` as one flat
`<button>` row (`FilePicker.tsx`, the `filtered.map(...)`). The column is a fixed
`w-60` (240px); on mobile the layout stacks via `md:flex-row`.

Two existing repo idioms cover the mechanics this change needs (reuse the
mechanics only, not the behavioral defaults):
- `resource-tree.tsx` — the *visual* fold idiom: `mdiChevronDown/Right` icon +
  `style={{ paddingLeft: depth*16 }}` indent. NOTE its groups default to
  *collapsed* and do NOT persist — the opposite of this change's requirement, so
  only the icon + indent are borrowed, not its collapse state.
- `useSidebarState.ts` + `ResizableSidebar.tsx` — an ALREADY-EXTRACTED hook that
  owns clamp + `localStorage` width/collapse persistence (keys `dashboard:sidebar-*`),
  with the component doing inline DOM width writes during drag and committing via
  `setWidth` on mouseup. This change reuses/mirrors that hook rather than
  re-implementing persistence.

Caveat (verify during implementation): the Directory-scope shell wraps the page
in `directory-settings-content` with `overflow-y-auto` but WITHOUT `flex flex-col`
(`DirectorySettings.tsx`), unlike the global `settings-content` wrapper which is
`flex flex-col min-h-0` (`SettingsPanel.tsx`). `InstructionsPage`'s internal
`h-full min-h-0` split may not resolve height correctly under the directory
wrapper — confirm the tree/editor fill vertically before relying on it.

Mockups grounding the target UI live in `mockups/` (`instructions-tree-resize.html`
desktop, `instructions-mobile.html` mobile master/detail).

## Goals / Non-Goals

**Goals:**
- Fold the flat candidate list into a collapsible folder tree keyed off
  `relPath` segments.
- Add a draggable resize gutter between the tree column and the editor.
- Persist collapse state and column width across reloads.
- Provide a mobile master/detail layout (no split, no resize).

**Non-Goals:**
- No change to `/api/file/md-candidates` or any server/shared code.
- No single-child directory collapsing (plain tree — decision below).
- No change to the URL-per-file selection model (kept intact).
- No tree for Packages/Resources pages (they already have their own tree).

## Decisions

**D1 — Build the tree client-side from `relPath`, don't change the API.**
The candidates response already carries `relPath` for every file. A pure
`buildTree(candidates)` that splits on `/` yields the nested structure with zero
protocol change. Alternative (server returns a nested shape) rejected: needless
API churn and a new contract to version.

**D2 — Plain tree; do NOT auto-collapse single-child directories.**
`.pi/skills/autofix/SKILL.md` renders as `autofix › SKILL.md`, producing repeated
`SKILL.md` leaves. Chosen for honesty and simplicity (matches the real FS shape;
users know the folder is the meaningful token). Alternatives — (B) collapse
single-child dirs like VS Code, (C) relabel generic leaves by parent — deferred;
they add custom logic for a cosmetic win and can layer on later without a spec
change.

**D3 — Persist only the collapsed set + width, default expanded.**
Store `dirset.collapsed` (array of collapsed dir paths) and `dirset.treeWidth`
in `localStorage`. Storing only collapsed paths means newly appearing folders
default to expanded automatically — no migration when the candidate set grows.
The collapsed set is scope-agnostic (dir paths are unique enough); revisit if
directory vs global scope needs separate state.

**D4 — Reuse the existing `useSidebarState` hook for the resize gutter, clamp 200–560px.**
The hook already provides clamped width + `localStorage` persistence and is tested;
this change imports/mirrors it (a `useTreeColumnWidth` peer with its own key) rather
than re-implementing drag persistence. Correction to an earlier draft: the hook is
NOT un-extracted — it exists at `hooks/useSidebarState.ts`, so there is no YAGNI
trade-off to make; the work is reuse, not invention. Drag = inline DOM width write
during move, commit via the hook's setter on mouseup (same as `ResizableSidebar`).

**D5 — Mobile = master/detail with an EXPLICIT view mechanism, not the depth-aware back.**
Correction to an earlier draft: the claim "the existing back-walk already returns
to the tree" is FALSE. Two existing behaviors block it: (a) the URL-resolution
effect auto-applies a default selection whenever `?file=` is absent
(`InstructionsPage.tsx`, so `selected` is never null after load), and (b) the
depth-aware back action treats `/folder/:cwd/settings/:page` as depth 1, so
`computeBackTarget` returns `/` (the card list), and file→file pushes are equal
depth so the fast-path is skipped. Therefore mobile master/detail is defined
explicitly:
- Default selection is **viewport-gated** — it applies only at ≥`md`. On mobile,
  absent `?file=` shows the tree (no auto-select), so `selected == null` is a
  reachable state. This is a MODIFICATION of the existing URL-encoded
  requirement, captured as a MODIFIED delta (not a silent ADD).
- The mobile editor header carries its own back control that navigates to the
  page route **without** `?file=` (clearing the query), which returns to the tree
  regardless of the depth-aware back action.
- Rows ≥44px for touch.

## Risks / Trade-offs

- **Collapse-state reset on re-render** → the render must read collapse state
  from the persistent `Set`, not from per-row DOM toggles; selecting a file must
  not rebuild folders to a default-expanded state. Covered by a test.
- **Deep trees / long names overflow the narrow column** → indent + ellipsis on
  the leaf name; the column is now resizable so users can widen it. Min width
  200px keeps chevrons + a few chars visible.
- **`localStorage` unavailable (private mode)** → wrap reads/writes so a throw
  degrades to in-memory (default expanded, default width), never crashes.
- **Mobile view-switch vs. back button** → do NOT rely on the depth-aware back
  action (it ejects to the card list); use an explicit in-editor back control
  that clears `?file=`. Verify this does not regress the desktop back-walk.
- **Directory-scope height wrapper** → `directory-settings-content` lacks
  `flex flex-col`; confirm the tree/editor split fills vertically or fix the
  wrapper. (Found in cross-model doubt review.)
- **Filter force-expand** → keeping a collapsed branch visible when a descendant
  matches needs ancestor traversal, not a flat `filter().map()`; budget for it.

## Migration Plan

Pure client change, no data migration. First load with no `localStorage` keys →
all folders expanded, default width. Rollback = revert the two component files;
stale `localStorage` keys are ignored by the old flat picker.
