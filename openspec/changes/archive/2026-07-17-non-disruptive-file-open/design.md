# Design — non-disruptive-file-open

## Problem framing: two independent axes

The current code conflates two decisions into one `openFile` path:

```
                 AXIS 1 — mode                 AXIS 2 — focus
                 (which panes show)            (which tab is active)
  today:         opener FORCES split           opener ALWAYS activates
  desired:       reveal only from closed;       user-click activates;
                 keep full / keep split         agent-open adds silently
```

They are orthogonal and must be decided separately. Collapsing them (as today)
means an agent writing a file both re-arranges the panes *and* steals what the
user is reading.

## The unified rule

```
  OPEN A FILE / CANVAS TARGET
  ───────────────────────────────────────────────────────────────

  intent?
   ├─ USER click (tree · chat-link · search · open-button)
   │     mode:  closed→split · split→split · full→full   (sticky)
   │     focus: activate the tab                         (user asked)
   │
   └─ AGENT auto (canvas · tool-result path)
         closed      → reveal split, SHOW it   (nothing being read)
         split/full  → mode UNCHANGED
                       add tab, DO NOT activate
                       mark unread + one-time pulse

  mobile (any): never auto-open → tap-to-open chip   (unchanged)
```

Two rules, each on one axis:

| Axis | Rule | Driver |
|------|------|--------|
| Mode | force `split` only when `closed`; else keep current mode | live `split.mode` |
| Focus | activate on user-click; silent + unread on agent-auto (editor already shown) | *intent* passed by the caller |

## Decision 1 — mode stickiness lives in the openers, not the reducer

The mode transition already lives in `SplitWorkspaceContext.tsx` (the openers call
`updateSplit`). Keep it there. Change the unconditional
`updateSplit({ mode: "split" })` to a guarded reveal:

```ts
// only reveal when there is nowhere to show the file yet
if (split.mode === "closed") updateSplit({ mode: "split" });
```

All five openers (`openInSplit`, `openLiveTarget`, `openUrlTarget`, `openDiffTab`,
`openChanges`) share this predicate — extract one `ensureRevealed()` helper (DRY).

A **sixth** mode-changer lives outside the openers: `SessionSplitView.tsx`'s
deep-link sync runs `else updateSplit({ mode: "split" })` for a param-less
`/session/:id/editor` navigation. Route it through `ensureRevealed()` too, so a
deep-link opened from `full` does not yank to `split`. (A deep-link *with* a `file`
param already goes through `openInSplit`.)

### Reading `split.mode` inside the openers — plain dep, no ref

The openers are `useCallback`s. Branching on `split.mode` needs the live mode.
**Add `split.mode` to each opener's dep array — that is the whole fix.** An earlier
draft proposed a `modeRef` to keep callback identity stable, but that is
over-engineering: the context `value` memo already depends on `split`, so it
re-creates on every mode change *regardless* of the openers' identity, and the
server open-files watch effect already keys on `split.mode` directly. A plain
`split.mode` dep is equally correct, avoids any render-phase-ref stale-read hazard
(incl. under concurrent React), and is simpler. No `modeRef`.

## Decision 2 — focus intent is a reducer flag, tagged by the caller

The reducer is intent-blind: a human click and an agent canvas dispatch the *same*
`openFile`. Add an explicit `activate` flag; **default `true`** so any un-tagged
call site keeps the safe, non-surprising behaviour (reveal + activate).

```ts
type EditorPaneAction =
  | { type: "openFile"; path; viewer; restrictCsp?; activate?: boolean }  // + activate
  | ...

// reducer, openFile:
//   activate === false + NEW tab           → push, keep activeIndex, unread: true
//   activate === false + EXISTING inactive → keep activeIndex, unread: true,
//                                            RE-PULSE (repeat agent write re-signals)
//   activate === false + EXISTING active   → no-op (active tab never unread)
//   activate !== false                     → today's behaviour (activate the tab)
```

**Invariant (gate decision): the active tab is NEVER unread.** Clearing is not a
`setActive`-only concern — it must hold wherever `activeIndex` lands. So `unread` is
cleared on the newly-active tab in BOTH `setActive` AND `closeTab` (which re-points
`activeIndex` at an adjacent tab that may be unread), each returning a NEW
`openFiles` array so the tab strip re-renders the cleared dot. A helper
`clearUnreadAt(openFiles, index)` keeps the sites DRY.

`OpenFile` gains `unread?: boolean`. `isValidState` treats it as optional so
persisted blobs written before this change stay valid — AND adds a type guard
(`unread === undefined || typeof unread === "boolean"`) so a corrupt blob with
`unread: 42` is rejected rather than rendering a stray dot.

### Who passes what — only ONE agent-driven path

The reviewer falsified the original "tool-result file auto-open" callsite: it does
not exist. `FileLink` (chat + tool-result paths) is a *click* handler → foreground.
The **only** non-click open path is the auto-canvas **effect**.

```
  FOREGROUND (activate: default true)      BACKGROUND (activate: false when shown)
  ─────────────────────────────────       ──────────────────────────────────────
  FileLink           (chat/tool click)     CanvasDriver auto-open EFFECT only:
  file-tree click                            · openInSplit  (file target)
  search-result select                       · openLiveTarget (loopback url)
  OpenFileButton     (tool btn)              · openUrlTarget  (generic url)
  ChatView openDiffTab (summary link)
  mobile canvas chip  onClick
```

**Shared-callsite hazard (reviewer HIGH):** `CanvasDriver.useOpenTarget` is reached
by BOTH the auto-open effect (agent → background) AND the mobile chip `onClick`
(user tap → foreground). `useOpenTarget` therefore takes a `background` argument;
the effect passes `true`, the chip passes `false`. And the background path must
extend to **all three** canvas openers (`openInSplit`, `openLiveTarget`,
`openUrlTarget`) — a `url`/`live-server` canvas target must also add silently, not
just files.

The three openers grow one option each:

```ts
openInSplit(relPath, line?, restrictCsp?, opts?: { background?: boolean })
openLiveTarget(url, opts?: { background?: boolean })
openUrlTarget(url, opts?: { background?: boolean })
```

`background` means: reveal only from `closed`; when the editor is already shown,
dispatch `openFile` with `activate: false`. When `closed`, a background open reveals
`split` and *does* activate (there is no reading context to protect).

**`restrictCsp` vs `background` are orthogonal axes** — `restrictCsp` gates document
viewer *egress* (CSP), `background` gates *focus*. Canvas file auto-opens set both,
but they are independent flags; do not collapse one into the other.

**`pendingScroll` + background:** `openInSplit` only stashes `pendingScroll` when
`line > 0`, and the pane consumes it only for the *active* tab. A background open
must NOT set `pendingScroll` (the tab is not activated; a stashed scroll would jump
unexpectedly when the user later opens the tab). Auto-canvas passes `line=undefined`
today, so this is a guard, not a live bug.

## Decision 3 — the unread affordance

- **Dot**: a small unread indicator on the tab while `unread === true`.
- **Pulse**: a one-time highlight the instant the tab is added OR re-signalled in
  the background, so a silently-arriving tab is *noticed* without stealing focus.
  Transient (keyed on the add/re-signal), not persisted in state; only the `unread`
  dot persists until the tab becomes active. A **repeat** background open of an
  already-unread tab **re-pulses** (agent wrote it again).
- **Reduced motion (gate decision, WCAG 2.2.2):** the pulse is gated behind
  `@media (prefers-reduced-motion: reduce)` — the unread **dot** still shows, no
  pulse animation plays.
- Clearing: the active-tab-never-unread invariant clears `unread` on any activation
  (click, keyboard `setActive`, or `closeTab` re-activation).

## State transition diagram

```
                     user-click open            user-click open
      ┌──────────────────────────────┐   ┌──────────────────────────────┐
      ▼                              │   ▼                              │
  ┌────────┐   user Editor      ┌────────┐   user open (any)      ┌────────┐
  │ closed │──────────────────▶ │  full  │──────────────────────▶ │  full  │ (sticky)
  │ (chat) │                    │(editor)│   agent open → add tab │(editor)│
  └────────┘                    └────────┘   silent + unread      └────────┘
      │  agent open  ─────────────▶ split (reveal + show)
      └──────────────────────────────────────────────────────────▶ split
                                   agent open in split → add tab silent + unread
```

## Non-goals / boundaries

- No new preview machine; reuses the existing split-workspace openers (same as
  auto-canvas Decision 1: coexist).
- Mobile chip path untouched.
- The header layout switch (`Chat│Split│Editor`) is a *user* control and keeps
  its explicit full/closed transitions — stickiness applies to **openers**, not to
  the user's own switch clicks.
- Does not touch the redesign-split-layout-controls control surface (divider,
  captions, seams). See proposal `## Coordination`.

## Intentional behaviour changes (name them so they are not “bugs”)

- **`openChanges()` (header Changed-Files chip) from `full` now stays `full`.**
  Previously it forced `split`. Now the tree/Changes rail expands *inside* the
  maximised editor while chat stays hidden. This is intentional per the new
  `Content opener from full stays full` scenario (which names the chip). It gets a
  manual-QA row so the visual (rail pushes the viewer in `full`) is signed off.
- **Deep-link `/session/:id/editor` with no `file` param from `full`** no longer
  yanks to `split` (routed through `ensureRevealed`).

## Risk

The design hinges on call sites tagging intent. A future new open entry point that
forgets to tag defaults to **foreground** (activate) — the benign, non-surprising
failure mode. The spec states this default explicitly so new call sites inherit it.
The one sharp edge is the shared `useOpenTarget` callsite (effect vs mobile chip) —
covered by an explicit test that the chip tap activates (foreground) while the effect
adds silently (background).
