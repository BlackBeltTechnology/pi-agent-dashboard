# Design — Editor Layout Modes

## Mockups

Interactive mockups live in `mockups/index.html` (open in a browser). They render,
top to bottom:

- **TODAY** — the buried `Split / Unsplit` pill among five identical siblings, with
  the three problems annotated.
- **OPTION A** — promote-in-place + rename to a lit "Editor" toggle (safe fallback).
- **OPTION B** — right-edge peek handle, closed vs open (spatial win).
- **OPTION C** — activity-bar / Chat-Editor as views (rejected: heaviest, over-built
  for two views).
- **OPTION B+** *(chosen, interactive)* — one `Chat | Split | Editor` segmented
  control in the header **plus** on-divider collapse chevrons + drag-to-resize. Click
  the segments, drag the split line, click its chevrons, use the edge peeks — all
  three states are live.

## State model

Replace the boolean with a three-value enum on the existing per-session split state.

```
        ┌──────┬───────┬────────┐   header segmented switch (all states)
        │ ▭ Chat│ ◧ Split│ ▮ Editor│
        └──────┴───────┴────────┘
   closed ◀────────▶ split ◀────────▶ full
 (chat only,      (chat | ‖ | editor,   (editor only,
  editor = right   draggable divider     chat = left
  peek handle)     w/ ‹ › chevrons)      peek handle)
```

`SplitState.open: boolean` → `SplitState.mode: "closed" | "split" | "full"`.
`ratio` and `orientation` are unchanged. `ratio` only applies in `split`.

### Migration

`isValidState` currently requires `typeof s.open === "boolean"`. Accept both shapes
for one release, with an explicit **precedence** so a blob carrying both fields
cannot silently corrupt:

1. If `s.mode ∈ {"closed","split","full"}` → use it (**`mode` wins over any legacy
   `open`**).
2. Else if `typeof s.open === "boolean"` → `open===true ? "split" : "closed"`.
3. Else (corrupt/partial) → `DEFAULT_SPLIT_STATE` (`mode: "closed"`).

`ratio` is still `clampRatio`'d on load (an out-of-clamp legacy ratio like `1.2`
is clamped, not rejected). **Strip-on-write:** the first `saveSplitState` after a
load writes only the new shape (no `open` key), so the both-fields ambiguity is
self-healing and cannot recur across upgrade/downgrade/upgrade.

`DEFAULT_SPLIT_STATE = { mode: "closed", ratio: 0.5, orientation: "h" }`.

The header calls a new `setMode(mode)`. The old `toggleSplit()` helper is **deleted**,
not retained: verified against source, every content opener (`openInSplit`,
`openChanges`, `openDiffTab`, `openLiveTarget`) and `SplitRouteSync` already call
`updateSplit(...)` directly — `toggleSplit` has **zero callers** once
`SplitToggleButton` is replaced. Keeping it would be exactly the speculative surface
the `code-simplification` checkpoint forbids.

## Controls — one axis, two consistent surfaces

| Surface | Present in | Reaches | Rationale |
|---|---|---|---|
| Header segmented switch `Chat│Split│Editor` | all states | any → any, 1 click | primary; visible even when `closed`, where no pane header exists |
| Divider chevrons `‹` / `›` + drag | `split` only | `split → full` / `split → closed` / resize | on the boundary itself; each chevron points at the pane it folds away |
| Right-edge "Editor" peek | `closed` | `closed → split` | bonus spatial affordance; where the pane appears |
| Left-edge "Chat" peek | `full` | `full → split` (or `closed`) | mirror; chat is never destroyed |

The retired affordances (a standalone maximize icon, ✕ close, ⟨⟩ restore in the pane
header) are **removed** — the segmented switch + divider chevrons subsume them. This
is the `code-simplification` win: 5 affordances/3 kinds → 2 consistent controls.

### Chevron direction rule

`‹` (points left, at the chat) folds the chat away → editor `full`. `›` (points
right, at the editor) folds the editor away → `closed`. "Click the arrow aimed at
what you want gone" — no grow-vs-shrink guessing, so no labels needed on the divider.

## Components touched (blast radius — enumerated from `grep -rn split.open|updateSplit|toggleSplit`)

**Source:**
- `packages/client/src/lib/split-state.ts` — `SplitState` type (`open`→`mode`),
  `DEFAULT_SPLIT_STATE`, `isValidState` (+ precedence migration), `loadSplitState`,
  strip-on-write in `saveSplitState`.
- `packages/client/src/components/SplitToggleButton.tsx` — **replaced** by
  `LayoutModeSwitch` (accessible exclusive control; see A11y below).
- `packages/client/src/components/SplitWorkspaceContext.tsx` — all `split.open`
  consumers → `split.mode` (incl. the server-watch effect, currently keyed on
  `split.open`); **delete** `toggleSplit`; add `setMode`; content openers set
  `mode: "split"`.
- `packages/client/src/components/SessionSplitView.tsx` — passes `open={split.open}`
  to `SplitWorkspace` (→ `mode`); `SplitRouteSync` writes `updateSplit({open:true})`
  (→ `{mode:"split"}`). **Both** call sites migrate.
- `packages/client/src/components/SplitWorkspace.tsx` — layout prop `open: boolean`
  → `mode`; render chat-only in `closed`, editor-only + chat peek in `full`, both +
  divider(chevrons) in `split`; right-edge editor peek in `closed`.
- `packages/client/src/components/editor-pane/EditorPane.tsx` — the ✕ close handler
  `updateSplit({open:false})` → `{mode:"closed"}`; retire `editor.closeEditorUnsplit`
  label → `editor.closeEditor` ("Close editor").
- `packages/client/src/components/SessionHeader.tsx` — swap `<SplitToggleButton/>`
  for `<LayoutModeSwitch/>` (desktop); **add a `LayoutModeSwitch` slot to
  `MobileHeader`**, which today hosts no split control (required for the spec's
  "present in every mode" on mobile).
- `packages/client/src/lib/i18n.tsx` + `i18n-hu.ts` — retire the full split-label
  set: `split.split`, `split.splitLabel`, `split.unsplit`, `split.unsplitLabel`,
  `editor.closeEditorUnsplit`; decide `common.split` (keep only if still referenced
  after the switch); add `layout.chat`/`layout.split`/`layout.editor` + peek/chevron
  tooltips — **both locales at 1:1 key parity**.

**Tests (compile/assert on `.open` today — must migrate):**
- `split-state.test.ts`, `SplitWorkspaceContext.test.tsx`, `SplitToggleButton.test.tsx`
  (rewrite for `LayoutModeSwitch`), `rail-width.test.ts`, `FileLink.split.test.tsx`.

**Docs (per project Documentation Update Protocol):**
- `packages/client/src/lib/split-state.ts.AGENTS.md` and
  `SplitWorkspaceContext.tsx.AGENTS.md` sidecar rows describe `(open, ratio,
  orientation)` — update to `(mode, ratio, orientation)`.

## A11y — exclusive segmented control

`LayoutModeSwitch` is a mutually-exclusive 3-option control, so it follows the
WAI-ARIA APG radio-group pattern, **not** the `role="group"`+`aria-checked` combo
(non-standard for exclusive choice): `role="radiogroup"` with three
`role="radio"` `aria-checked` segments, roving `tabindex`, Arrow/Home/End navigation,
and an accessible name per segment. The active mode is the checked radio (announced).
This is a deliberate upgrade from the single `aria-pressed` toggle it replaces.

## ChatView in `full`

In `full`, `ChatView` is **kept mounted and hidden** (e.g. `hidden`/off-screen), not
unmounted — so composer draft text and scroll position survive a `split→full→split`
round-trip. The chat peek restores visibility without remounting.

## Open questions

1. **Header label vs icon-only.** The mockup uses glyph+word (`▭ Chat`). The real
   desktop header is cramped; icon-only with tooltips may fit better. Decide during
   implementation with the live header. (Does not affect the a11y contract — each
   radio keeps an accessible name regardless of visible glyph vs word.)
2. **Mobile placement.** `MobileHeader` gains a `LayoutModeSwitch` slot. `full` =
   editor fills the stacked area; the chat peek becomes an edge **grabber** on the
   stacked edge. Exact grabber pixel placement is a manual-QA confirmation on a 360px
   phone (task 7.2) — the *requirement* (switch present + peek activatable in every
   mode) is testable now; only the visual placement is deferred.
3. **Should content openers ever target `full`?** No — they open `split` so chat
   stays visible. A user in `full` who clicks `Changed Files` is moved `full→split`
   (chat returns); this is intended and covered by a spec scenario. "Open maximized"
   is out of scope.
