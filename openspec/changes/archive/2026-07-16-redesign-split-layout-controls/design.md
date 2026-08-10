# Design — split layout controls redesign

## Approved mockup (source of truth for implementation)

- `mockups/index.html` — the **approved** design (v2). Live-servable; renders
  dark + light. Implementers MUST match this: header order, dotted-grip seams,
  always-visible captions, in-flow rotated restore tabs, vertical `SESSIONS` tab.
- `mockups/v1.html` — superseded first pass (hover-reveal tabs, dual controls).
  Kept only to show what was rejected and why.
- `mockups/ux-review.md` — the scored UX review + cited rules.

Serve locally during implementation:
`node -e "require('http')..."` or the mockup-loop `serve_mockup` tool on the
`mockups/` dir; open `/index.html` (approved) and `/v1.html` (rejected).

## Research → decisions (every decision cites a public rule)

| Decision | Rule (source) |
|---|---|
| Captions + grips are **always visible**, not hover-only | "visual separation should be always visible, not simply a hover effect … hidden until hover, users will not properly recognize it" — NN/g, *Split Buttons* |
| **One** selector drives collapse; divider only resizes | "A split view's content area is always visible. The pane can expand and collapse …" — one content + one collapsible pane — Microsoft Fluent, *SplitView* |
| Restore tab is **in-flow (push)**, never overlay | Fluent `Inline` mode "reduces the space available for content, pushing content out of its way" vs `Overlay` — inline avoids clipping a narrow pane |
| Header segmented control = the mode selector | segmented control is the canonical mutually-exclusive view switch (Apple HIG / Material) |
| Progressive disclosure keeps the primary control obvious | "place the advanced features button in a clearly visible spot … strong information scent" — NN/g, *Progressive Disclosure* |

## Mental model (what removes the confusion)

```
ONE selector  →  "which view?"    Chat │ Split │ Editor   (header; always visible)
ONE seam      →  "how much?"      drag the dotted grip    (rail + divider, identical)
captions      →  passive identity in split; become the vertical
                 restore tab when collapsed  ┃SESSIONS┃ ┃CHAT┃ ┃EDITOR┃
```

- Header switch is the single source of truth for `closed│split│full`.
- The divider carries **no** collapse control — only resize.
- Every collapse/restore across the app (rail + both panes) uses **one** rotated
  vertical-tab idiom, so the "session button" and "chat/editor button" read as
  one system.

## The overlap bug — why the redesign fixes it structurally

Old: the chevron cluster is `absolute left-1/2 -translate-x-1/2` on a 6px bar, so
its ~24px width bleeds into both panes and lands on chat content when the chat
ratio is small. New: each restore tab is an **in-flow flex sibling anchored to the
pane edge** — it can never float over a pane's content. The bug is removed by
construction, not by tuning offsets.

## Header order (final)

`[← back]  session name  [✎ rename]  [ Chat │ Split │ Editor ]  [◎ Seek]  … `

Removed from the header: `model`, `thinkingLevel` — both already render on the
session card in the rail. **Kept in the header: `pi <version>`** — it is currently
the only UI surface for the per-session pi version (a version-skew signal), so it
is retained rather than dropped. (Verified: `SessionCard.tsx` shows `model` +
`thinkingLevel` on desktop but has no `piVersion`; the header `model` uses the
live `state.model || session.model` while the card uses polled `session.model`.)

## Pane captions integrate, they do not stack

`ChatView` and `EditorPane` already render their own top chrome. The always-
visible `CHAT` / `EDITOR` caption SHALL be **folded into that existing pane
header** (a label in the current header row), NOT added as a second bar above it —
otherwise content height shrinks and the pane is double-labeled.

## Out of scope

- Mobile/stacked (`orientation="v"`) tab placement — the captions/tabs rotate to
  top/bottom edges there; tracked as a follow-up, not built here. The new
  caption + rotated-tab requirements are therefore **scoped to the desktop
  horizontal split (`orientation "h"`)**; the mobile stacked split keeps its
  existing edge-grabber peek behavior unchanged (the untouched "Content area
  SHALL host a chat + editor split" mobile scenarios remain in force).
- The tablet `replaceChat` tier (editor replaces chat, no side-by-side) renders
  no divider, captions, or restore tabs — that early-return path is untouched.
- Any change to persisted `split` / `sidebar` localStorage shapes.
