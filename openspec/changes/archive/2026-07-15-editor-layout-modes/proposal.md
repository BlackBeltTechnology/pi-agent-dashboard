# Editor Layout Modes

## Why

The `split-editor-workspace` capability (archived 2026-07-03) shipped the internal
editor pane co-mounted with `ChatView`, controlled by a single boolean `split.open`
and a header pill labelled **"Split / Unsplit"** (`SplitToggleButton.tsx`). Live use
surfaced three UX problems with that control:

1. **The toggle is hard to find.** `SplitToggleButton` renders one `text-[10px]`
   outlined pill in the desktop session header, visually identical to five siblings
   in the same right-cluster (`Attach`, `Modules`, `Changed Files`, `Resume`,
   `Fork`). Nothing marks it as a *view* control, and it sits mid-cluster while the
   pane it summons slides in from the far right — no spatial link between affordance
   and result.

2. **"Split / Unsplit" names the mechanism, not the intent.** Users scan for
   "editor / code / files", not "split". "Unsplit" is a non-standard word (VS Code
   and browsers say "Close editor" / "Toggle panel"). The pane's own internal title
   is already **"Editor"** (`editor.editorTitle`), so the label contradicts what
   appears.

3. **There is no full-size editor.** `split.open` is binary — chat+editor or
   chat-only. A user reading a large file cannot give the editor the whole width;
   they are stuck at the clamped `[0.25, 0.75]` divider ratio. When they do want the
   editor big, the chat wastes a quarter of the viewport.

Today the shipped affordances for this axis are exactly two: the header
"Split / Unsplit" pill (`SplitToggleButton`) and the editor pane's ✕ close button
(`EditorPane.tsx:187`, `updateSplit({ open: false })`). A **naive** way to add a
third "full" state would scatter more one-off icons (a maximize here, a restore
there) — this proposal instead routes the whole `closed ↔ split ↔ full` axis through
one consistent control set (a header segmented switch + on-divider chevrons), so the
affordance count does not grow with the state count.

Mockups for the current control, the rejected placement options (A promote-in-place,
B edge-peek, C activity-bar), and the chosen **B+** model (one segmented control +
on-divider collapse controls, all three states live and clickable) live in
`mockups/index.html` and are part of this proposal.

## What Changes

- **MODIFIED** capability `split-editor-workspace`: the split's binary
  `open: boolean` becomes a tri-state layout mode `mode: "closed" | "split" | "full"`.
  `closed` renders `ChatView` alone (today's default), `split` renders chat + divider
  + editor (today's open), and `full` renders the editor alone with `ChatView`
  **kept mounted but hidden** (composer draft + scroll survive) and collapsed to a
  leading-edge **peek handle**. Existing persisted `open` blobs migrate
  (`open:true → "split"`, `open:false → "closed"`); corrupt/absent → `closed`. When a
  blob carries **both** `mode` and legacy `open`, `mode` wins; the first successful
  load re-persists the new shape and **strips `open`** so the ambiguity cannot recur.

- **MODIFIED** the header control: `SplitToggleButton` (the "Split / Unsplit" pill)
  is replaced by a **segmented layout switch** — `Chat | Split | Editor` — that owns
  the whole axis, reaches any state in one click, and is exposed as an accessible
  exclusive control (`role="radiogroup"` / `radio` per WAI-ARIA APG, arrow-key
  navigable, active segment announced). It is present in every state on desktop
  **and** gets a slot in the mobile header (`MobileHeader`, which today hosts no
  split control). The words "Split"/"Unsplit" as toggle labels are retired.

- **REMOVED** the now-orphaned `toggleSplit()` context helper: content openers call
  `updateSplit({ mode: "split" })` directly and the header no longer toggles, so it
  has zero callers after the switch lands. The editor pane's ✕ close is retargeted to
  `mode: "closed"` and its `editor.closeEditorUnsplit` label retired.

- **ADDED** on-divider collapse controls: in `split` mode the draggable divider
  carries two chevrons. `‹` collapses **chat** (→ `full`); `›` collapses **editor**
  (→ `closed`). Each chevron points at the pane it folds away. Dragging the divider
  still resizes and persists the ratio (unchanged clamp `[0.25, 0.75]`).

- **ADDED** peek handles as a bonus spatial affordance: in `closed`, a right-edge
  "Editor" peek re-opens to `split`; in `full`, a left-edge "Chat" peek restores
  chat. Peeks never destroy pane or chat state.

- Content-driven openers (`openInSplit`, `openChanges`, `openDiffTab`,
  `openLiveTarget`, chat file-links) target `split` (not `full`) — unchanged
  behaviour, retargeted from the boolean to the mode.

Out of scope: activity-bar navigation (option C), renaming the pane's contents
("Code"/"Files"), keyboard shortcuts / command-palette entries (tracked as a
follow-up), any change to the editor pane internals (tree, tabs, search, diff), and
the pre-existing orientation write-on-mount pattern (orientation stays
responsive-derived, not user state — untouched here).

## Discipline Skills

- `doubt-driven-review` — the state-model migration (`open` boolean → `mode` enum,
  persisted per session) is a cross-boundary, hard-to-reverse change; review before
  it stands.
- `code-simplification` — the end goal collapses five ad-hoc affordances into two
  consistent controls; verify the implementation actually reduces surface area.
