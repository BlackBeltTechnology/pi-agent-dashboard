## Context

See `proposal.md` — *Why* for the seven defects and their measurements. This
document records only what shapes the implementation. Every claim below was
re-verified against current `origin/develop`, because the proposal was ported
from a fork branched ~124 commits back.

Verified baseline on `develop`:

| Item | Current code | Fork's premise still true? |
|---|---|---|
| §1 drag styles | `ResizableSidebar.tsx:42-43/59-60`, `SplitDivider.tsx:47-48/62-63`, `FileDiffView.tsx:172-173/190-191` all write `document.body.style` in handlers only. `useTreeColumnWidth.ts:57-58/70-71/87-88` has the guarded-cleanup pattern. | Yes, verbatim |
| §2 copy | `CopyButton.tsx` calls `navigator.clipboard.writeText` with an empty catch. `lib/util/clipboard.ts#copyText` exists and returns a boolean. | Yes, verbatim |
| §3 reconcile maps | `useStaleToolReconcile.ts` deletes only `inFlightRef`. `lastAttemptRef`/`count404Ref` never pruned. Additionally verified: `event-reducer.ts` never deletes from `state.toolCalls` (only `createInitialState` clears), so a tool row persists for the session's lifetime once created. | Yes — and worse than stated (see D3) |
| §4 mobile | `MobileShell.tsx:42` root is `w-screen h-[100dvh] overflow-hidden`; `App.tsx:2678` mobile branch wraps it in a plain `<div>` with `PluginStalenessBanner` + `ConnectionStatusBanner` in flow above it. The one other child of that wrapper, `addFoldersDialog` (`App.tsx:2441`), renders inside `<DialogPortal>` and so contributes no height either. The `presentation: "page"` plugin-overlay branch (`App.tsx:2661`) returns *before* this wrapper and is already `fixed inset-0` with no banners — out of scope for D4. | Yes, verbatim |
| §5 scroll | **Moved, but the defect is live.** `develop` has `programmaticScrollUntilRef` + `stampProgrammaticScroll()` (`SETTLE_MS = 120`) — but it feeds ONLY `pendingUserIntentRef` / `evaluateAutoLoad` (`ChatView.tsx:1371`), never `handleScroll`'s near-bottom branch. Both bottom-pin writes (`onChange` `:1189`, follow effect `:1503`) stamp it and then fall into `handleScroll`'s `else` at `:1348`, which sets `stickToBottomRef = nearBottom` → `false`. The `descendingRef` latch (`:1334`) is the right shape but is set only by `scrollToBottom`. The scroll container (`:1629`) wires `onScroll`/`onCopy`/`onWheel`/`onTouchMove` only — there is no keyboard or scrollbar listener to hook. | Defect yes; fix must be re-derived |
| §6 markdown | No `MarkdownRenderContext`; `MarkdownContent.tsx:492` passes an inline `components={{...}}` object. `App.tsx:1498-1503` memoizes `toolContext` on the whole `sessionStates` map. | Yes, verbatim |
| §7 idle FX | `index.css:645-647` pauses on `:root.app-hidden *`, driven by `useAppHidden`. No visible-but-idle pause. | Yes, verbatim |

One proposal claim was verified rather than assumed, and the verification came
back narrower than the claim. Inside this repo, `ToolContext.session` is read
only by `AgentToolRenderer.tsx:229`, which forwards it to `SubagentDetailView`,
whose declared `SessionStateLike` reads exactly one field — `session.subagents`
(`packages/subagents-plugin/src/client/SubagentDetailView.tsx:107`). `FileLink`
uses `context.sessionId`, not `context.session`.

But that is an audit of *in-repo* consumers, not of the contract. The field is
declared `session?: SessionState` — the **whole** state — in
`components/tool-renderers/types.ts:36`, and `ToolCallStep.tsx` resolves plugin
`tool-renderer` slot claims *before* the built-in registry, handing them the same
`ToolContext`; the type is re-exported for external embedders. So "narrowing is
lossless" holds for the code in this repo and is an unverifiable assumption about
anything outside it. D7 resolves that by narrowing the declared type rather than
leaving a full-looking `SessionState` that is silently stale.

Capability placement differs from the proposal's first draft (confirmed with the
user): §1 lands in a new cross-cutting `drag-body-style` capability rather than
`patch-editing-and-resize`, and §4 becomes an ADDED requirement on the existing
`mobile-resilience` capability rather than a new `mobile-shell`. `proposal.md`
was updated to match.

## Goals / Non-Goals

**Goals:**

- Each of the seven fixes is pinned by a red test that fails on today's `develop`
  before the fix lands. §5 in particular must be *re-reproduced* against the
  current settle-window code, not against the fork's shape.
- §5's fix composes with the existing latch family (`descendingRef`,
  `ascendingRef`, `programmaticScrollUntilRef`) rather than adding a fourth
  parallel mechanism with overlapping authority over `stickToBottomRef`.
- §7 pauses *all* animations, so a background streaming card cannot keep the
  compositor awake.

**Non-Goals:**

- Splitting the idle-FX item into its own change. The proposal flagged it as a
  split candidate; it stays here. It shares only one hook mount in `App.tsx` with
  the rest, so it can still be reverted independently by commit.
- Any behavior change to `useTreeColumnWidth` (already correct; its effect also
  owns localStorage persistence — merging it into the shared hook is a separate
  cleanup).
- Rewriting the "mouse released outside the window" case with pointer capture or
  a `blur` listener. Unmount cleanup is the bound this change buys; a lost
  `mouseup` while still mounted remains as today.
- Any user-visible failure signal for a failed copy (§2 keeps silent failure), any
  cap on client message arrays, and any trim of `scrollStateMap` — all explicitly
  excluded in the proposal.

## Decisions

### D1 — One shared drag-style hook, guarded by an `active` ref

`useBodyDragStyle()` returns `beginBodyDrag(cursor)` / `endBodyDrag()` and
registers exactly one unmount cleanup that calls `endBodyDrag()`. Both functions
are idempotent and gated on an internal `active` ref: `endBodyDrag` on an
inactive instance is a no-op.

The `active` guard is what makes the hook safe with two mounted consumers and
under React StrictMode's double mount/unmount: an unconditional cleanup would let
an idle sidebar's unmount clear the styles out from under a split divider that is
mid-drag.

*Alternatives considered.* (a) Add a cleanup to each of the three components
individually — three copies of a subtle guard, which is how this class of bug
recurs. (b) Reference-count body overrides globally — more machinery than three
call sites justify, and the failure it guards against (two simultaneous drags)
cannot happen with mouse input.

Components keep their existing `dragging` ref. It still gates move/up logic; the
hook's `active` ref is private lifecycle state, not a second copy of it.

### D2 — CopyButton delegates to the existing `copyText`

`copyText` (writeText → hidden textarea + `execCommand("copy")` → boolean) is
already the path `ToolsSection` uses. `CopyButton` calls it and shows ✓ only on
`true`.

*Alternative considered.* Writing a fallback inside `CopyButton` — rejected: a
second implementation of the same fallback is exactly the drift this repo's DRY
rule targets.

### D3 — Prune reconcile bookkeeping from a pure selector, per tick

Add pure `selectActiveToolKeys(states): Set<string>` beside the existing
selectors, and have `tick()` delete every `lastAttemptRef`/`count404Ref` key not
in that set **before** scanning.

**"Active" means `status === "running"`, not "still present in state".** This is
load-bearing, not a detail: `event-reducer.ts` never deletes from
`state.toolCalls`, so *every tool call ever executed remains a present row* for
the life of the session. A prune keyed on presence would therefore delete nothing
and the fix would be a no-op against the exact defect it targets. `selectActiveToolKeys`
yields the running rows and nothing else.

This is lossless because the scan only ever consults keys of rows the selectors
still yield (`selectStaleRunningTools` / `selectSupersededHealTargets` both guard
`status === "running"`); a pruned key is by construction one the scan cannot
reach. Running rows keep their backoff and 404 counts. `inFlightRef` is untouched
— it self-clears in `finally`.

One ordering wrinkle, accepted rather than guarded: a reconcile request already
in flight when its row goes terminal can re-insert that row's key into
`count404Ref` from the response handler (`useStaleToolReconcile.ts:159`) after the
tick pruned it. The re-inserted key is bounded — at most one per in-flight
request, discarded by the next tick. Adding a second liveness check inside the
async handler would buy a 4 s window of tidiness for a real race hazard, so the
prune stays the single point of truth.

*Alternatives considered.* (a) TTL eviction — introduces a second clock and can
evict a live row's 404 count, silently resetting its backoff. (b) An LRU cap —
same hazard plus an arbitrary constant. The live key set is already derivable
exactly; approximating it is strictly worse.

Placing the prune before the scan (not after) means the deletion pass and the
bookkeeping it walks are proportional to running rows. Note the bound this buys
is on the **bookkeeping maps**: the selectors themselves still iterate every
`toolCalls` entry per tick, which is pre-existing behavior and out of scope here.

### D4 — The viewport bound moves up to the App mobile root

`App.tsx`'s mobile branch root becomes `flex flex-col h-[100dvh] overflow-hidden`;
`MobileShell`'s root drops `w-screen h-[100dvh]` for `w-full flex-1 min-h-0`.
Banners stay in flow and simply take height from the flex container.

The invariant this establishes: **exactly one element owns a viewport unit, and
it is the one that also owns `overflow-hidden`.** Today two elements each claim
`100dvh`-worth of space (banner stack + shell), which is the overflow.

`min-h-0` is required — a flex child's default `min-height: auto` refuses to
shrink below content size and would reintroduce the overflow from inside.

The viewport-anchored overlays (`Toast`, `SpawnErrorToastHost`,
`RecoveryOfferHost`, `WorktreeInitStack`, first-launch modal) are `fixed` /
`fixed inset-0` and contribute no height to the flex flow — verified, and pinned
by a spec scenario so a future overlay added in-flow is caught.

*Alternative considered.* Making the banners `fixed` and padding the shell —
requires the shell to know each banner's height, which is dynamic.

### D5 — The scroll fix is a pin snapshot on the existing latch family

This is the highest-uncertainty item and the one whose baseline moved. The
mechanism on `develop`, stated precisely:

1. A bottom-pin executes `el.scrollTop = el.scrollHeight`. The browser clamps the
   write to the extent that exists *now*.
2. Rows below the viewport measure in; `scrollHeight` grows (observed
   21136 → 39578).
3. The pin's induced scroll event dispatches. `nearBottom` is now false by
   13 388 px, with no gesture.
4. `handleScroll` takes the `else` branch (`:1348`) — `descendingRef` is false
   because only `scrollToBottom` sets it — and clears `stickToBottomRef`.

**Why not widen the existing time window.** `programmaticScrollUntilRef` is a
120 ms deadline. Extending it to cover measurement growth would need a bound on
how long measurement takes, which does not exist (it scales with transcript
length — the exact axis where the defect appears). It would also blind the
auto-load intent tracker, which is that ref's actual job, for the whole window.
A time window is the wrong predicate: the question is not *when* the event
arrived but *which write caused it*.

**Why not just set `descendingRef` on the pin.** `descendingRef` holds
`stickToBottom = true` for *any* intermediate event until `nearBottom` becomes
true. A pin that lands mid-transcript because the user really did scroll away
would then latch the follow on and yank them back. `descendingRef` is safe for
`scrollToBottom` only because that write is an explicit user request to go to the
bottom.

**Four bottom-pin writers, not two.** Besides the virtualizer `onChange` re-pin
(`ChatView.tsx:1189`) and the follow effect (`:1503`), the session-switch restore
effect writes to the bottom on **two** of its three paths:

- `:1461-1464` — the "near bottom or first visit" branch: sets
  `stickToBottomRef = true`, then `scrollTo(0, scrollHeight)`. This is the site
  the `chat-scroll-lock` delta's *"Long session opens at the latest message"*
  scenario actually exercises. The other writers usually mask it by re-pinning in
  the same commit, but on a switch where the follow effect's deps are unchanged
  it is the last writer and the defect survives.
- `:1456-1459` — the **anchor-row-not-found fallback** inside the scroll-locked
  restore: when the saved `anchorRowId` resolves to no current index, it also
  writes `scrollTo(0, scrollHeight)`. Easy to misread as part of the restore, but
  it pins to the bottom like any other, and it fires precisely in this change's
  target population (long session, anchor row outside the retained window).

All four tag `"pin-bottom"`. The genuine `"jump"` in that effect is the
`idx >= 0` path (`:1443-1455`: `scrollToIndex` + the rAF intra-row offset),
together with `scrollToBottom`, `scrollToTurn` and splice corrections.

Note the clamp branch **preserves** the follow state the pin established rather
than forcing it true — which is what makes tagging `:1456-1459` safe: that path
deliberately sets `stickToBottomRef = false` (`:1438-1440`), and preserving
`false` through a measurement clamp is exactly as correct as preserving `true`.

**Decision.** Programmatic writers tag themselves as `"pin-bottom"` or `"jump"`.
A bottom-pin additionally records a snapshot at write time: the `scrollTop` it
actually achieved and the `scrollHeight` it saw. `handleScroll` consults the tag
*before* its position rules, and treats the event as a follow-preserving clamp
only when **all** hold:

- the tag is `"pin-bottom"`, and
- the event's `scrollTop` matches the recorded achieved position **within a
  one-pixel tolerance** (the browser clamped us there; we have not moved since),
  and
- `scrollHeight` has grown since the snapshot (growth is what made the position
  look non-bottom), and
- the pin landed with real content (guards the empty/zero-height case, where
  every comparison is trivially satisfiable).

The tolerance is not incidental: `scrollTop` readback is fractional under
non-100 % zoom, fractional `dvh`, and mobile device-pixel rounding — including on
the 390×844 device this defect was measured on. An exact `===` would fall through
on a sub-pixel readback difference and silently reintroduce the defect on exactly
that form factor, in a way the test helper (which clamps, but does not round to
device pixels) would never catch. One pixel is far below the escape gestures this
must still detect (the observed escape was 13 388 px).

Anything else falls through to today's rules unchanged, so a real escape still
releases the follow. `"jump"` writers (`scrollToBottom`, `scrollToTurn`, restore,
splice corrections) leave the pin refs untouched.

**The attribution is single-use.** It is cleared on two paths, and the second is
not optional: the existing `onWheel`/`onTouchMove` → `cancelDescent` path is
extended to clear it (keeping one place that means "the user took over", where
`descendingRef`/`ascendingRef` are already cleared), **and** the first scroll
event tested against the snapshot consumes it — an event that falls through
clears it too.

The second path is what makes the no-listener answer for scrollbar-drag and
keyboard escapes correct rather than merely convenient. Those inputs move the
position off the recorded pin, so they fail the equality clause and fall
through — but without consumption the stale snapshot would survive an entire
scrollbar-only session and could be re-matched later by an unrelated event that
happens to land on the same `scrollTop` while content grew, silently re-arming
the follow away from the bottom. Consumption also bounds the double-pin
interleave (the pin sites can write within one growth cycle): the overwritten
first event falls through and clears, and the second pin re-arms from its own
snapshot.

Attribution is also reset on `sessionId` change. Without it, a snapshot recorded
in the outgoing session can be tested against the incoming session's first
event — comparing growth to a `scrollHeight` from a different transcript.

Placement is specific: the reset belongs in the restore effect's **unconditional**
prologue, beside `prevSessionRef.current = sessionId` (`ChatView.tsx:1432`),
before the branch split. It must NOT be attached to the
`descendingRef`/`stickToBottomRef` clears at `:1438-1440` — those run only on the
scroll-locked-restore path, so a reset placed there would be skipped on exactly
the near-bottom/first-visit switch that needs it most.

**One coupling the clamp must not forget.** `handleScroll` also persists the raw
`nearBottom` into `scrollStateMap` (`ChatView.tsx:1352-1362`) for
switch-away-and-back restore. A clamp-preserved event must persist the state it
*preserved*, not the raw `false`, or the follow survives in-session and is then
thrown away by the next session switch — restoring mid-transcript with the
scroll-to-bottom button showing, after no user gesture.

**Sequencing requirement.** The red test must be written first and must
reproduce against *current* `develop`, using a `setScrollPosition` test helper
that clamps like a real browser (assigning `scrollTop` beyond the extent must
clamp, not store). A test that lets `scrollTop` exceed `scrollHeight` cannot
express this bug at all. Two regressions are required, not one: the clamp holds
the follow through growth, **and** a view moved above the pin with no gesture
still releases.

### D6 — Stable module-level markdown renderers behind a context

`react-markdown`'s `components` map is compared by identity per key; a new
function identity for `p`/`code`/`a`/`table` is a new component *type*, which
React unmounts and recreates rather than reconciling. Any `Selection` anchored in
those nodes collapses.

Renderers move to module scope (stable identities) and read what they need —
`ToolContext`, syntax theme, loopback-link behavior, image base — from a new
`MarkdownRenderContext`. The `components` object then becomes a module constant.

**Provider placement and the no-provider path are part of this decision, not an
implementation detail.** The provider is mounted *inside* `MarkdownContent`,
wrapping its `react-markdown` element, with a value memoized on the individual
fields it carries.

To be precise about why — mounting it higher would **not** reintroduce the defect;
once the component types are stable, a context-value change re-renders consumers
but never unmounts or recreates their DOM, which is the whole mechanism D6 buys.
The reason for the inner placement is narrower: the value is genuinely per-instance
(`MarkdownContent` takes `context` as a prop and embedders mount it standalone),
so a single high provider would have to reconcile several callers' values. Node
identity is preserved by stable types either way; placement only decides who owns
the value.

`MarkdownContent`'s `context` prop is optional (`MarkdownContent.tsx:37`) and
`chat-embed` embedders mount it without one, so the context's default value must
be a complete, inert object — no `fileLink` (linkification already degrades to
plain text on absence, per `types.ts`), no `session`, default syntax theme. A
module-scope renderer must never assume a provider is above it.

*Alternative considered.* Memoizing the `components` object on its inputs. This
fails for the reported repro: the inputs (a fresh but *equivalent* `ToolContext`)
change identity, so the memo misses and the identities churn anyway. D7 reduces
how often that happens, but only the context indirection makes it structurally
impossible.

D6 and D7 are complementary, not redundant: D7 removes the dominant *trigger*,
D6 removes the *sensitivity*. Either alone leaves a hole — D7 alone still churns
whenever the selected session updates, D6 alone still rebuilds the context object
on every background event.

This is the largest diff in the change (`MarkdownContent.tsx`, ~595 lines today).
If review judges the blast radius too large to land alongside six other fixes, it
splits out cleanly — nothing else here depends on it.

### D7 — `ToolContext` retains only the selected session's `subagents`

`App.tsx:1498-1503` memoizes on `sessionStates` (the whole map), so any session's
SSE/thinking update mints a new context. Narrow the dependency to the selected
session's `subagents` map — the only field any consumer reads.

**The declared type narrows with it.** `ToolContext.session` is currently
`session?: SessionState` (`types.ts:36`) and is handed to plugin tool renderers
before built-ins (`ToolCallStep.tsx`), so narrowing only the memo *dependency*
would leave a field that still advertises the whole `SessionState` while silently
freezing every non-`subagents` field between `subagents` changes — stale data
behind a type that promises fresh data, which is strictly worse than no data.
The field is therefore re-declared as the `subagents`-bearing subset, keeping its
optionality — `session?: { subagents: SessionState["subagents"] }`. It stays
optional because `App.tsx:1499-1500` passes `undefined` whenever no session is
selected, and embedders build contexts without it. `SubagentDetailView`'s
`SessionStateLike` already declares exactly that shape, so the in-repo consumer is
unaffected; an out-of-repo renderer reading another field now gets a compile
error instead of stale values. The narrowing is a deliberate, breaking contract
change on a re-exported type — called out in the proposal's Impact so it lands in
the changelog rather than surprising an embedder.

*Alternatives considered.* (a) A deep/structural equality check on the built
context — pays a comparison on every event and still allocates; narrowing the
input is cheaper and self-documenting. (b) Keep `SessionState` and narrow only
the memo dependency — rejected above: silent staleness. (c) Drop D7 and rely on
D6 alone — rejected: D6 removes the sensitivity but leaves every background event
rebuilding the context and re-rendering every consumer.

### D8 — `useIdleFx` mirrors `useAppHidden`, with a deliberate activity set

`useIdleFx()` toggles `fx-idle` on the document root after `IDLE_FX_DELAY_MS`
(5000) without activity; `index.css` gains a `:root.fx-idle *, *::before, *::after
{ animation-play-state: paused !important }` block mirroring the existing
`app-hidden` block at `:645-647`. Mounted in `App.tsx` next to `useAppHidden()`.

Activity = `pointerdown`, `wheel`, `keydown`, `touchstart`, `focusin` — listened
at **capture** on `document`, so activity inside a stopped-propagation subtree
still counts. `focusin` also fires for a *programmatic* `element.focus()` (dialog
open, popout flows), which will restart the idle timer without a user present.
Accepted: it is a one-shot restart, not a hold — the pause lands 5 s later — and
filtering on `isTrusted` would drop genuine keyboard-driven focus moves.

**`pointermove` and `scroll` are deliberately excluded.** A resting hand emits
pointer micro-moves, and streaming auto-scroll dispatches trusted `scroll`
events; either would hold FX alive for the entire lifetime of a 24 h stream,
i.e. exactly the case this exists to fix. Cost of the exclusion: a user who only
moves the mouse sees animations pause after 5 s and resume on their next real
input — acceptable, since nothing functional depends on an animation
(`animationend` is unused repo-wide) and resume is within one frame.

Scope is **all** animations, not just the selected card's neon trio: a background
streaming card's stripes and dots alone measured 3268 ms / 13.3 s (~24.6 % of a
core). State remains legible because every animated state also has static color;
the static selection affordance (`ring-1 ring-blue-500/30 border-blue-500/60`) is
retained and pinned by a `SessionCard` test so a class rename cannot silently
break the CSS selectors.

**With one exemption: indeterminate progress indicators keep animating.** This is
where `fx-idle` must diverge from `app-hidden` rather than mirror it. `app-hidden`
is safe to apply universally because nobody is looking; `fx-idle` fires while the
user is looking at the screen, and a spinner frozen mid-rotation during a genuine
in-flight operation reports "hung", not "idle". The static-color argument that
covers the decorative animations does not transfer: a spinner's *motion* is the
entire signal.

The exemption needs **two** selectors, because the client spins glyphs two
different ways. Tailwind's `animate-spin` covers 39 call sites and costs nothing
to exempt. The rest use `@mdi/react`'s `spin` prop (`ToolBurstGroup.tsx:227`,
`StatusBar.tsx:54`, `UnifiedPackagesSection.tsx:329`/`:360`), which applies
`animation: spin … infinite` as an **inline style with no class attached** — an
`!important` pause still overrides it, but no class selector can exempt it. Those
four sites therefore get an explicit `fx-progress` opt-out class (the `Icon`
component forwards `className`), which is also the hook any future non-Tailwind
indicator uses.

This matters because `ToolBurstGroup`'s rotating `mdiLoading` glyph is the
canonical "this tool is running" indicator in the transcript — the single most
important thing not to freeze.

**It must not leak past the two stronger pauses.** An exemption written as one
rule does leak, in two ways that both regress shipped behavior:

1. The exemption selectors are specificity (0,3,0); the shipped hidden-window
   pause `:root.app-hidden *` (`index.css:644-647`) is (0,2,0). Both are
   `!important`, so the exemption **wins**. And `useIdleFx` has no visibility
   gate — a hidden window receives no input, so it goes idle after 5 s and carries
   *both* classes. Spinners would keep animating in a tray-hidden window, breaking
   the shipped `ui-animation-energy` requirement outright.
2. The off-screen pause `.fx-offscreen *` (`index.css:649-657`, from
   `reduce-chat-render-cpu-umbrella` Phase 1) is only (0,1,0) and loses the same
   way. `SessionCard` is an FX container containing `animate-spin`
   (`SessionCard.tsx:852` / `:1136`), and `ToolBurstGroup` is one containing an
   `fx-progress` glyph (`:119` / `:227`), so an off-screen card's spinner would
   resume.

The exemption is therefore a three-selector ladder, and the re-pause rules must
follow it in source order:

```css
/* Idle-only exemption: a visible user reads a frozen spinner as a hang. */
:root.fx-idle .animate-spin,
:root.fx-idle .fx-progress { animation-play-state: running !important; }
/* … but hidden-window and off-screen pauses still win. */
:root.app-hidden .animate-spin,                    /* (0,3,0), later → wins */
:root.app-hidden .fx-progress,
:root.fx-idle .fx-offscreen .animate-spin,         /* (0,4,0) → wins */
:root.fx-idle .fx-offscreen .fx-progress {
  animation-play-state: paused !important;
}
```

The invariant to hold: **the exemption applies only when the sole reason to pause
is idleness.** Nobody is looking at a hidden window or an off-screen card, so the
"frozen spinner reads as a hang" argument does not apply there — the exemption
must not either. A spec scenario pins each precedence so a later refactor of the
pause blocks cannot silently invert it.

*Alternative considered.* Gate `useIdleFx` on `visibilityState` so `fx-idle` is
never set while hidden. That fixes (1) but not (2), and leaves the precedence
implicit in JS rather than stated in the cascade where the pauses live.

**Scope of "indeterminate progress indicator" is rotation, and that boundary is
deliberate.** `animate-pulse` is **not** exempt — skeleton/liveness decoration
whose state is carried statically, and it includes the status-dot pulses this
change exists to stop. Nor is `.tool-group-spin-pulse` (`index.css:464`), the
opacity pulse on a running tool group's `mdiLoading` glyph: unlike a bare
spinner it sits inside a group frame whose running state is already carried by
static styling. That makes the exempt/non-exempt line *class choice*, which is a
weaker rationale than "motion is the only signal" — accepted for now as the
minimal rule, and task 5.3b audits the animation inventory for any other
animation whose motion carries information. That audit must cover **both**
`index.css` keyframes and package-injected animations applied by inline style
(the `@mdi/react` case above is exactly what a CSS-only audit misses). The known
candidate is `.flow-edge-animated` (`index.css:632-638`), where dash direction
indicates edge direction.

Cost of the exemption is one running animation whenever an operation is genuinely
in flight. By this change's own measurement (~9.7 % CrGpuMain for a single 8×8 px
rotating div) that is not free — so the "drops to near-idle" outcome is claimed
for the unattended case with **no operation in flight**, which is the case being
optimized.

`fx-idle` and `app-hidden` are independent and compose — both are pause-only, so
whichever is set pauses, and both must clear for animation to run.

*Alternative considered.* Pausing via `document.getAnimations()` in JS (which is
how the effect was measured). Rejected: it is imperative, must be re-run for
animations created after the pause, and does not survive a re-render — the CSS
class is declarative and already proven by `app-hidden`.

## Risks / Trade-offs

- **§5's fix is timing-sensitive and its baseline moved** → red test first,
  reproducing on current `develop`; browser-faithful clamping in the test helper;
  two regressions (hold-through-growth AND release-without-gesture) so a fix that
  over-holds fails.
- **§5 interacts with three existing latches** (`descendingRef`, `ascendingRef`,
  `programmaticScrollUntilRef`) → the pin branch is consulted before the position
  rules and is strictly narrower than `descendingRef`'s; `scrollToBottom` /
  `scrollToTop` behavior must be re-verified by their existing tests, unchanged.
- **§6 is a large rewrite of a 595-line file** → it is independently revertible
  and depends on nothing else here; if review objects, it splits to its own
  change without blocking the other six.
- **§7 pausing all animations could hide state** → static color already
  distinguishes every animated state; a spec scenario and a `SessionCard` test
  pin the static selection affordance.
- **§7's activity set could feel unresponsive** (mouse-move-only users) →
  5 s delay, one-frame resume, no functional dependency on animation, and the
  `animate-spin` exemption keeps in-flight work legible while paused.
- **§6/§7 (D7) narrows a re-exported public type** (`ToolContext.session`) →
  breaking for an out-of-repo tool renderer that reads a non-`subagents` field;
  chosen over silent staleness so the break is a compile error. No in-repo
  consumer is affected (`SessionStateLike` already declares the narrow shape).
- **§3's prune could be a no-op** if "active" were read as "present" — tool rows
  are never evicted from client state → D3 fixes the semantics to `running`, and
  a scenario pins that terminal rows' bookkeeping is discarded while present.
- **§4 could regress desktop layout** → the change is confined to the `isMobile`
  branch of `App.tsx` and to `MobileShell`, which desktop does not render.
- **§1's guard could over-clear with two draggers** → the two-instance isolation
  case is an explicit spec scenario and an explicit test.
- **§3's prune could evict live backoff state** → the selector is pure and
  unit-tested directly; a scenario pins that a live 404-counting row keeps its
  state across a prune.

## Migration Plan

No data migration, no persisted-format change, no server or protocol change —
every item is client-local. Deploy is the normal client path: `npm run build` +
`POST /api/restart`.

Rollback is per-item by commit revert; the only shared file is `App.tsx` (three
independent edits: mobile flex root, `toolContext` deps, `useIdleFx()` mount).

Land order: §1 §2 §3 §4 (independent, low risk) → §7 (independent, self-contained)
→ §6/§7-context (D6+D7 together) → §5 last, since it is the item most likely to
change shape once re-reproduced.

## Open Questions

- `IDLE_FX_DELAY_MS = 5000` is a first guess. It is a single constant with no
  behavioral coupling, so it can be tuned after the change lands without touching
  the specs, the approach, or the task breakdown.
