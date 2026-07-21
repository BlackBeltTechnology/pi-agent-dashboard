## Why

The `split` workspace ships collapse controls that confuse users and break at
narrow widths:

- The divider's collapse chevrons are tiny (`size 0.5`), tint only on hover, and
  carry no resting label — hard to find, easy to miss.
- The chevron cluster is **absolutely centered on a 6px bar**, so it bleeds into
  both panes and **overlaps chat content** when the chat pane is narrow (the
  maximized-window overlap bug).
- Collapse exists in **two places** — the header `Chat│Split│Editor` switch and
  the divider chevrons — giving two competing mental models for the same action.
- The session-list (left rail) resize handle is invisible and speaks a different
  visual language than the split divider, so the two seams feel unrelated.

Research on the shipped design (NN/g, Microsoft Fluent) confirms these are known
anti-patterns: a signifier hidden until hover is not recognised (NN/g "hidden
signifier"), and a split view should be **one always-visible content area + one
collapsible pane driven by one obvious control** (Fluent SplitView), not two
symmetric collapsers. See `mockups/ux-review.md` and `design.md`.

## What Changes

- **One selector.** The header `Chat│Split│Editor` segmented control becomes the
  single explicit view selector. It moves to sit after the session name/rename,
  **immediately before the Seek button**. **Model name and thinking level** are
  removed from the header (both already shown on the session card). **Pi version
  stays in the header** — it is currently the only place the per-session pi
  version is surfaced (a version-skew signal), so it is kept, not dropped.
- **Divider = resize only.** The split divider loses its collapse chevrons. It
  becomes a resize-only seam with an **always-visible dotted grip**.
- **Always-visible pane captions.** Each pane wears an always-visible `CHAT` /
  `EDITOR` caption (the label users asked to bring back), replacing the
  hover-only affordance.
- **In-flow rotated restore tabs.** When a pane is collapsed, its caption returns
  as a rotated vertical tab that is **in-flow (pushes content), never overlaying**
  — killing the narrow-pane overlap bug.
- **Unified session-list seam.** The left rail gains the **same dotted-grip
  resize seam** as the divider. The collapse control stays a **vertically centered
  knob** (already centered in the shipped code — unchanged). When collapsed, the
  rail restores via a **vertical `SESSIONS` tab** using the identical idiom as the
  CHAT/EDITOR restore tabs.
- **Desktop scope.** The caption + rotated-tab changes govern the desktop
  horizontal split (`orientation "h"`). The stacked mobile split
  (`orientation "v"`) keeps its existing edge-grabber peek behavior unchanged;
  mobile rotated-tab placement is a follow-up (see `design.md` non-goals).

The approved design is the live mockup at `mockups/index.html` (v2); the
superseded first pass is `mockups/v1.html`.

## Capabilities

### New Capabilities

_(none — this modifies existing capabilities)_

### Modified Capabilities

- `split-editor-workspace`: divider drops on-border collapse chevrons (resize +
  always-visible dotted grip only); collapse is driven solely by the header
  switch; peek handles become always-visible in-flow rotated tabs plus
  always-visible pane captions.
- `resizable-sidebar`: the drag handle becomes an always-visible dotted-grip seam
  matching the divider; the collapsed rail restores via a vertical `SESSIONS` tab
  matching the pane peeks.

## Impact

- **Code**:
  - `packages/client/src/components/SplitDivider.tsx` — remove `onCollapseChat` /
    `onCollapseEditor` chevron cluster; render an always-visible dotted grip.
  - `packages/client/src/components/SplitWorkspace.tsx` — add always-visible pane
    captions; convert edge peeks to in-flow rotated tabs (push, not overlay).
  - `packages/client/src/components/SessionHeader.tsx` — reorder header (mode
    switch before Seek); remove the `model` + `thinkingLevel` segments (both live
    on the session card). Keep the `pi <piVersion>` segment (no other UI home).
    Note: header `model` uses live `state.model || session.model`; the card uses
    polled `session.model`, so mid-session model display remains on the card.
  - `packages/client/src/components/ResizableSidebar.tsx` — dotted-grip seam;
    vertical `SESSIONS` restore tab; keep centered collapse knob.
- **Tests**: existing `SplitWorkspace` / divider tests updated for the removed
  chevrons + new tabs; sidebar tests updated for the new seam/restore idiom.
- **UX**: collapse now has one home (the header switch); the overlap bug is
  structurally removed.
- **Persistence**: no change to the `pi-dashboard:split:<id>` /
  `pi-dashboard:sidebar` shapes.

## Discipline Skills

- `code-simplification` — the change removes a redundant control path (divider
  chevrons) and unifies two seam implementations; verify the result is simpler,
  not just moved.
