## Why

Opening a file is currently **disruptive** in two ways that fight the user:

1. **Mode is not sticky.** Every file-open entry point funnels through the
   openers in `SplitWorkspaceContext.tsx`, each of which calls
   `updateSplit({ mode: "split" })` *unconditionally*. So a user who has
   deliberately maximised the editor (`full` mode, chat hidden) is yanked back to
   `split` the moment any file opens — including agent-driven auto-canvas opens.
   The `split-editor-workspace` spec even locks this in with the scenario
   `Content opener from full returns to split` ("the opener never sets `full`").

2. **Focus is always stolen.** The `openFile` reducer in `editor-pane-state.ts`
   *always* sets `activeIndex` to the opened tab. So when the agent auto-opens a
   file (canvas target, tool-result path) while the user is reading a *different*
   tab, the content the user was reading is swapped out from under them.

The result: an agent writing files mid-run repeatedly rips the user off whatever
they were reading and re-arranges their panes. Users asked for the editor to stay
put and for new agent-opened files to arrive **quietly**.

## What Changes

Two orthogonal rules, cleanly separated.

- **Mode axis — `full` becomes sticky.** Openers force `split` only when the
  current mode is `closed` (the editor must be revealed to show anything).
  When the editor is already shown (`split` or `full`), the opener leaves the
  mode unchanged. `full` stays `full`; `split` stays `split`.

- **Focus axis — agent opens are silent.** File-open callers now declare
  *intent*:
  - **User-initiated** (file-tree click, chat file-link via `FileLink`,
    search-result select, Open-file button, the mobile canvas chip tap) →
    **foreground**: reveal + activate the tab (today's behaviour, minus the
    mode-yank). NOTE: a chat file-link / tool-result path is a *click* — it is
    foreground, not agent-driven.
  - **Agent-initiated** — the **only** non-click open path is the **auto-canvas
    driver** (the effect in `CanvasDriver`, not its chip `onClick`). It opens
    **background** when the editor is already shown: add the tab **without**
    changing `activeIndex`, mark it **unread**, and play a **one-time
    highlight/pulse** so the user notices it appear. When the mode is `closed`,
    the agent open reveals `split` and shows the file (nothing is being read, so
    surfacing it is the point). This covers file, `live-server`, and `url` canvas
    targets alike — all three canvas openers get the background path, not just
    `openInSplit`.

- **Unread affordance.** `OpenFile` gains an `unread` flag, set when a tab is
  added in the background and cleared the moment the user activates it
  (`setActive`). The tab strip renders an unread dot plus the one-time pulse.

- **Mobile unchanged.** Auto-canvas still never yanks on mobile; the
  tap-to-open chip path is untouched.

## Capabilities

### New Capabilities

_(none — this modifies existing capabilities)_

### Modified Capabilities

- `split-editor-workspace`: the "Opening a file auto-opens the split" and
  "Peek handles" requirements change so openers preserve the current mode when
  the editor is already shown (only `closed` reveals `split`); the
  `Content opener from full returns to split` scenario is replaced by
  `Content opener from full stays full`. A new requirement covers foreground vs
  background open intent and the unread affordance.
- `auto-canvas`: the auto-open transition opens in the **background** (no active-tab
  change, unread + pulse) when the editor is already shown; it reveals `split`
  only from `closed`. Mobile chip behaviour is unchanged.

## Coordination

`redesign-split-layout-controls` (active, in-progress) modifies the **same**
`split-editor-workspace` capability and **carries the same scenario this change
overturns** — `Content opener from full returns to split` (under its "Peek
handles SHALL restore a collapsed pane" requirement). That change is about the
*controls* (divider grip, header switch, captions, in-flow restore tabs); this
change is about *opener behaviour* (mode stickiness + background tabs + unread).

- **No code overlap:** the redesign touches `SplitDivider.tsx`,
  `SplitWorkspace.tsx`, `SessionHeader.tsx`, `ResizableSidebar.tsx`. This change
  touches `SplitWorkspaceContext.tsx`, `editor-pane-state.ts`, and the
  `EditorPane` tab strip. The openers and the reducer are untouched by the
  redesign (verified: no `openInSplit` / `openFile` / `activeIndex` references in
  its artifacts).
- **Spec overlap is a whole requirement, not one scenario.** Both deltas modify
  the same `split-editor-workspace` requirement `Peek handles SHALL restore a
  collapsed pane` (redesign rewrites it for in-flow tabs + captions; this change
  appends "a content-driven opener SHALL NOT change the mode when the editor is
  already shown" and flips the `Content opener from full …` scenario). The
  redesign's `Divider carries no collapse control` scenario also asserts "the
  only controls that change the layout mode are the header switch and the pane
  restore tabs" — which becomes incomplete once openers still reveal from
  `closed`; the rebase must reconcile that line too. This change **must land
  after** `redesign-split-layout-controls`; if it lands first, the redesign
  rebases instead.

## Impact

- **Code**:
  - `packages/client/src/lib/editor-pane-state.ts` — `openFile` action gains
    `activate?: boolean` (default `true`); `OpenFile` gains `unread?: boolean`;
    `setActive` clears `unread`; `isValidState` tolerates the new optional field.
  - `packages/client/src/components/SplitWorkspaceContext.tsx` — `openInSplit`,
    `openLiveTarget`, `openUrlTarget` gain a `background` flavour; the
    `updateSplit({ mode: "split" })` in all five openers becomes a conditional
    reveal (reveal only from `closed`, read via a plain `split.mode` dep — see
    design Decision 1); background opens dispatch `openFile` with
    `activate: false` when the editor is already shown.
  - `packages/client/src/components/CanvasDriver.tsx` — the auto-open **effect**
    passes `background: true`; the **mobile chip `onClick`** passes foreground
    (`useOpenTarget` takes a `background` arg so the shared callback serves both
    callsites with the right intent).
  - `packages/client/src/components/SessionSplitView.tsx` — the param-less
    `/session/:id/editor` deep-link branch (`else updateSplit({ mode: "split" })`)
    is a 6th mode-changer outside the openers; route it through the same reveal
    guard so a deep-link from `full` does not yank to `split`.
  - Known non-opener `openFile` dispatch: `EditorPane.tsx` `live:preview` button
    (a user click, only reachable when the editor is mounted). It never calls
    `updateSplit`, so it preserves mode already; left as-is, documented as an
    exception rather than "every open funnels through openers".
  - Call-site intent audit (foreground unless noted): `FileLink` (chat/tool-result
    click), file-tree click, search-result select, `OpenFileButton`,
    `ChatView` `openDiffTab` (change-summary link), mobile canvas chip tap →
    foreground; **only** the `CanvasDriver` auto-open effect → background.
  - `packages/client/src/components/editor-pane/EditorPane.tsx` — tab strip
    renders the unread dot + one-time pulse; clears on activate.
- **Tests**: reducer unit tests (activate:false adds without focus + sets unread;
  setActive clears it); opener tests (closed→split reveal; full stays full; split
  stays split; background vs foreground). **Rewrite the existing `F9` test** in
  `SplitWorkspaceContext.test.tsx` — it currently asserts the *inverse* ("openers
  from full land in split, never full") and must flip to the new contract. A
  tab-strip render test for the unread affordance.
- **UX**: agent file writes no longer disrupt the reader; the editor stays where
  the user put it.
- **Persistence**: `pi-dashboard:editor-pane:<id>` gains an optional `unread`
  field on open tabs; older blobs remain valid (field optional).

## Discipline Skills

- `doubt-driven-review` — the intent-blind reducer means correctness hinges on
  every call site tagging foreground vs background; stress-test the default
  (foreground) is the safe fallback before it stands.
- `code-simplification` — five openers share one conditional mode rule; verify it
  collapses to a single helper rather than five copies.
