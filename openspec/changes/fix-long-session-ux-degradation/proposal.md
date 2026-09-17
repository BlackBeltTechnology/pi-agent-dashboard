# Fix long-session UX degradation + pause decorative FX while idle

> **Provenance.** Ported from the `JessieKaa/pi-agent-dashboard` fork, commit
> `758dc7f25` — which carries **two** fork changes,
> `fix-ux-degradation-long-session` and `pause-decorative-fx-when-idle`. The fork
> branched at `67111dfae` and is ~124 commits behind; every defect below was
> re-verified against current `origin/develop` (see *Upstream delta* per item).
> **Split candidate:** the idle-FX item (§6) is independently shippable and may be
> promoted to its own change during `plan-proposal` — it shares no file with §1–§5
> except `App.tsx` (one hook mount).

## Why

Seven deterministic defects that only surface after the dashboard has been open a
while. Each has an isolated mechanism, not a guess.

1. **Copy/selection dies permanently after a resize drag.** Three drag-to-resize
   components set `document.body.style.cursor` + `userSelect = "none"` on
   `mousedown` and clear them only in their `mouseup` handler. Effect cleanups
   remove the listeners but **not the styles**. Unmount mid-drag (breakpoint flip,
   panel collapse, session switch) leaves the page at `user-select: none`
   **forever** — nothing is selectable or copyable until a refresh. (A `mouseup`
   lost outside the window strands the styles the same way, but that case stays
   as-is: fixing it needs pointer capture or a `blur` listener, an explicit
   non-goal below. Unmount cleanup is the bound this change buys.) The correct
   guarded-cleanup pattern already exists in
   `useTreeColumnWidth`; it was never applied to the three older draggers.
   *Upstream delta:* present verbatim — `ResizableSidebar.tsx:42-60`,
   `SplitDivider.tsx:47-48`, `FileDiffView.tsx:172-191`. No `useBodyDragStyle` on
   `develop`.
2. **`CopyButton` silently fails in non-secure contexts.** It calls
   `navigator.clipboard.writeText` directly and swallows every failure
   (`catch {}`, no fallback), so over an http tunnel (zrok/ngrok) the button does
   nothing while still looking like a button. A working fallback — `copyText` in
   `lib/util/clipboard.ts` (writeText → hidden textarea + `execCommand("copy")`,
   returns boolean) — already exists and is used by `ToolsSection`.
   *Upstream delta:* present verbatim — `CopyButton.tsx` still has the bare
   `await navigator.clipboard.writeText(...)` + empty catch.
3. **The stale-tool reconcile diagnostic maps only grow.**
   `useStaleToolReconcile` keys `lastAttemptRef` and `count404Ref` by
   `${sessionId}:${toolCallId}` and never deletes. In a 24 h session every tool
   call ever run leaves two permanent map entries — unbounded growth proportional
   to tool-call count, plus the per-tick scan cost of iterating them.
   *Upstream delta:* the file exists on `develop` and is otherwise current; only
   `inFlightRef` is deleted (`:178`). No prune of the two diagnostic maps.
4. **The mobile page scrolls, dragging the whole shell out of the viewport.**
   The App's mobile branch renders in-flow banners (`PluginStalenessBanner`,
   `ConnectionStatusBanner`) above `MobileShell`, whose root is `w-screen
   h-[100dvh]`. Banner height + `100dvh` exceeds the viewport, so the **document**
   becomes scrollable by exactly the banner height. Measured at 390×844:
   `document.scrollHeight` 887 vs `innerHeight` 844 with the 43 px staleness
   banner visible. Entering a session or focusing the composer then scrolls the
   page and the header/progress bar ends up mid-screen.
   *Upstream delta:* `MobileShell.tsx:42` still `w-screen h-[100dvh]`.
5. **A long session lands mid-conversation, never at the latest message.** The
   bottom-pin writes `el.scrollTop = el.scrollHeight` (clamped to the
   then-current maximum); rows below the viewport then measure in and grow
   `scrollHeight` **before** the induced scroll event dispatches. That event reads
   `nearBottom = false` with no gesture involved and `handleScroll`'s else-branch
   clears the follow, parking the view wherever growth stopped. Measured on a live
   session at 390×844: `scrollTop 25521 / max 38909` — 13 388 px of unread content
   below — frozen while `scrollHeight` climbed 21136 → 39578. This violates the
   shipped `chat-scroll-lock` requirement ("the auto-scroll chase SHALL continue
   across every subsequent `event_replay` batch until either replay completes or
   the user performs a real scroll gesture").
   *Upstream delta:* **`develop` has moved** — `ChatView.tsx` now guards with a
   *time window* (`programmaticScrollUntilRef` + `SETTLE_MS`, lines 457/481/625)
   rather than the fork's pre-fix shape. The fork's fix (writer tag + pin
   snapshot) must be **re-derived on top of the current window logic**, and the
   defect must be re-reproduced against `develop` before any code lands — it may
   be partially mitigated by the window today. This is the highest-uncertainty
   item in the change.
6. **A background stream destroys selections in the foreground transcript.**
   `App` rebuilds `ToolContext` whenever the whole `sessionStates` map changes —
   including a thinking/SSE update for an *unselected* session.
   `MarkdownContent` then hands `react-markdown` fresh inline renderer functions;
   React treats new function identities as new component types and
   unmounts/replaces the matching paragraph, code, link and table nodes. A browser
   `Selection` anchored to those nodes collapses. Isolated repro: 26 foreground
   child-list mutations from a single background event; zero after the fix, even
   under a 60/s event stream.
   *Upstream delta:* no `MarkdownRenderContext` on `develop`; renderers are still
   closure-captured inline functions.
7. **An idle, unattended dashboard burns ~17 % of a CPU core.** Chrome trace over
   14.6 s of strict idle (no streaming, no input): GPU `CrGpuMain` 1423 ms (~10 %),
   `VizCompositorThread` 680 ms (~5 %), renderer `Compositor` 335 ms (~2 %).
   Pausing `document.getAnimations()` collapses it (CrGpuMain 10 % → 1.6 %). The
   cost is **fixed per-frame pipeline overhead, not raster size**: a single 8×8 px
   rotating div reproduces ~9.7 % CrGpuMain — a browser never idles while *any*
   infinite animation runs. A follow-up trace showed a *background streaming*
   card's stripes + status-dot pulses alone cost 3268 ms per 13.3 s (~24.6 % of a
   core), dropping to 8 ms when paused.
   *Upstream delta:* `develop` ships `:root.app-hidden *` animation pausing
   (`index.css:645-647`, driven by `useAppHidden`) — i.e. **hidden tab and
   off-screen only**. "Visible but idle" is out of the shipped
   `ui-animation-energy` scope and is the state a user is actually in. No
   `useIdleFx` on `develop`. This is the complementary, larger win.

Evaluated and explicitly **excluded** (each needs its own proposal): capping
client message arrays (breaks history-gap / spliceRev / two-sided terminus
semantics), granular context splitting for the display-prefs/model-config maps
(18 consumers, medium risk), trimming `scrollStateMap` (e2e
`chat-transcript-virtualization.spec.ts` depends on its survival), and the
`blur`-listener / pointer-capture rewrite for "mouse released outside window".

## What Changes

- **New shared hook `useBodyDragStyle`** — owns the body cursor/userSelect write
  pair with one unmount cleanup guarded by an `active` ref and an idempotent
  `endBodyDrag()`. Unmount while dragging clears the styles; unmount while idle
  touches nothing (StrictMode double-invoke safe).
- **The three draggers delegate to the hook** — they keep their own `dragging` ref
  (still gates move/up logic) and call `beginBodyDrag(cursor)` / `endBodyDrag()`
  instead of writing `document.body.style`. `useTreeColumnWidth` is deliberately
  NOT refactored (already correct, and its effect also owns localStorage
  persistence — future merge candidate).
- **`CopyButton` routes through `copyText`** — ✓ icon only on a `true` result;
  failure stays silent exactly as today (no new toast — deliberately not widening
  scope).
- **The mobile root owns the viewport bound.** App's mobile branch becomes
  `flex flex-col h-[100dvh] overflow-hidden`; `MobileShell`'s root drops
  `w-screen h-[100dvh]` for `w-full flex-1 min-h-0`. Banners can then appear and
  disappear without the document exceeding the viewport. The viewport-anchored
  overlays (`Toast`, `SpawnErrorToastHost`, `RecoveryOfferHost`,
  `WorktreeInitStack`, first-launch modal, add-folders dialog) are
  `fixed`/`fixed inset-0` and add no height inside the flex flow.
- **`useStaleToolReconcile` prunes its diagnostic maps each tick** — new pure
  selector `selectActiveToolKeys(states)` builds the live key set; `tick()` deletes
  every `lastAttemptRef`/`count404Ref` key not in it, before scanning. Lossless:
  the scan only reads keys of rows that still exist (selectors guard
  `status === "running"`). `inFlightRef` untouched (self-clearing in `finally`).
- **The scroll machinery learns WHICH write produced an event** — *re-derived
  against `develop`'s current settle-window logic.* Programmatic writers tag
  themselves (`"pin-bottom" | "jump"`); `handleScroll` consults the tag before its
  position rules. A `"pin-bottom"` event is held as a follow-preserving clamp only
  when it matches the recorded pin snapshot (achieved scrollTop + scrollHeight at
  write time) AND content has since grown AND the pin landed with real content;
  anything else falls through, so a real escape (wheel/touch, scrollbar drag,
  keyboard) still releases. The tag clears ONLY on real input. `"jump"` writers
  (scrollToBottom, scrollToTurn, restore, splice corrections) leave the refs
  untouched.
- **The selected `ToolContext` ignores unrelated session-state churn** — `App`
  retains only the selected session's `subagents` map (the sole state its
  agent-tool consumers read), so another session's update cannot mint a new
  otherwise-equivalent context. `ToolContext.session` is **re-declared** from the
  whole `SessionState` to the `subagents`-bearing subset so the type matches what
  is actually kept fresh — a deliberate breaking change on a type re-exported to
  embedders, chosen over leaving a full-looking field silently stale.
- **Markdown renderers get stable module-level component types** — dynamic
  content, `ToolContext`, syntax theme and loopback-link behavior flow through a
  `MarkdownRenderContext` instead of closure-captured inline functions, so React
  reconciles existing markdown DOM nodes instead of remounting them.
- **New `useIdleFx()` + `fx-idle` CSS pause** — while on-screen and interacting
  (pointerdown, wheel, keydown, touchstart, focusin at capture) animations run
  normally; after `IDLE_FX_DELAY_MS` (5000 ms) with no input the client sets
  `fx-idle` on the document root and ANY input clears it immediately.
  `pointermove` and `scroll` are deliberately **not** activity (a resting hand
  emits micro-moves; streaming auto-scroll emits trusted scroll events — either
  would hold the FX alive for a whole 24 h stream). CSS mirrors the existing
  `app-hidden` wildcard block (`*`, `*::before`, `*::after` →
  `animation-play-state: paused !important`) and covers **all** animations except
  indeterminate progress spinners (`:root.fx-idle .animate-spin` keeps running —
  unlike a hidden tab, an idle-but-visible user reads a frozen spinner as a hang),
  not just the selected card's neon trio — a background streaming card's stripes and
  status dots cost the same per-frame overhead, and static state colors still
  communicate the state. Everything resumes within one frame on first input;
  nothing functional depends on animation completion (`animationend` unused
  repo-wide). Static selection affordance (`ring-1 ring-blue-500/30
  border-blue-500/60`) is retained.

## Capabilities

### Added Capabilities

- `drag-body-style` — a drag's body cursor/userSelect pair is scoped to the drag
  lifecycle and is ALWAYS cleared on drag end **and** on unmount. Cross-cutting:
  covers all three draggers (sidebar, split divider, diff tree panel).

### Modified Capabilities

- `mobile-resilience` — the mobile root SHALL bound itself to the viewport
  (`100dvh` + `overflow-hidden`) and stack in-flow banners above a flexing shell,
  so no banner can make the document scrollable. (Added requirement on the
  existing capability that already owns the mobile navigation shell.)

- `content-copy` — CopyButton's path becomes fallback-backed via shared
  `copyText`; ✓ feedback driven by its success boolean.
- `incremental-event-sync` — the stale running-tool reconcile's per-row
  diagnostic state SHALL NOT grow without bound; keys for vanished rows are pruned
  each tick.
- `chat-scroll-lock` — the auto-scroll follow SHALL survive a measurement clamp;
  a real user escape SHALL still release it. Sharpens the existing multi-batch
  replay requirement.
- `chat-selection-preservation` — a background session's SSE/thinking update SHALL
  NOT replace the selected foreground transcript's markdown DOM nodes or collapse
  its selection.
- `ui-animation-energy` — all animations SHALL pause while the UI is **visible but
  idle**, resuming on first input, so an unattended dashboard produces zero
  compositor frames even while background sessions stream.

## Impact

**Code**

- NEW `packages/client/src/hooks/useBodyDragStyle.ts`, `useIdleFx.ts`.
- `components/shell/ResizableSidebar.tsx`, `components/split/SplitDivider.tsx`,
  `components/diff/FileDiffView.tsx` (inline `ResizableTreePanel`) — delegate to
  the hook.
- `components/primitives/CopyButton.tsx` — use `copyText`.
- `hooks/useStaleToolReconcile.ts` — `selectActiveToolKeys` + per-tick prune.
- `components/shell/MobileShell.tsx` — `w-full flex-1 min-h-0`.
- `components/chat/ChatView.tsx` — writer-tagged programmatic scroll, pin
  snapshot + clamp branch, tag clearing on wheel/touch (on top of the existing
  settle window).
- `components/preview/MarkdownContent.tsx` — module-level renderers +
  `MarkdownRenderContext` (provider mounted inside `MarkdownContent`; inert
  default for provider-less embedders).
- `components/tool-renderers/types.ts` — `ToolContext.session` narrowed from
  `SessionState` to the `subagents`-bearing subset. **Breaking** for an
  out-of-repo tool renderer reading any other field; no in-repo consumer affected.
- `App.tsx` — viewport-bounded mobile flex root; selected-only `ToolContext`
  subagents; mount `useIdleFx()` next to `useAppHidden()`.
- `index.css` — `:root.fx-idle *` pause block mirroring `app-hidden`, plus the
  `:root.fx-idle .animate-spin` running-override that exempts indeterminate
  progress indicators.

**Tests**

- NEW `useBodyDragStyle.test.tsx` — set/clear, unmount-mid-drag clears,
  unmount-before-drag no-op, two-instance isolation.
- NEW `useIdleFx.test.tsx` — class appears after the delay, clears on input,
  timer resets on activity (fake timers).
- NEW `shell/__tests__/MobileShell.test.tsx` — root fills its parent, never claims
  a viewport unit.
- `ResizableSidebar.test.tsx` — body style set on drag start, cleared on mouseup
  and on unmount-mid-drag.
- `CopyButton.test.tsx` — real failure → execCommand fallback shows ✓ and removes
  the hidden textarea; no execCommand → no throw, no ✓.
- `useStaleToolReconcile.test.ts` — pure selector semantics (`running`-only) +
  tick-driven prune, including that a present-but-terminal row's bookkeeping is
  discarded and a still-running row keeps its backoff/404 count.
- `ChatView.scroll-race.test.tsx` — browser-faithful clamping `setScrollPosition`
  plus two regressions: the measurement clamp holds the follow through growth; a
  view moved above the pin with no gesture still releases.
- `MarkdownContent.test.tsx` — equivalent fresh `ToolContext` values preserve
  paragraph, inline-code, link and table DOM identity.
- `SessionCard.test.tsx` — the selected card renders the FX layer classes (guards
  the CSS selectors against rename drift).

**Docs**

- `AGENTS.md` rows: `hooks/` (two new files + `useStaleToolReconcile` detail),
  `shell/`, `split/`, `diff/`, `primitives/`, `src/` (`index.css` fx-idle block),
  plus per-file sidecars for `SplitDivider.tsx`, `FileDiffView.tsx`, `App.tsx`,
  `preview/MarkdownContent.tsx`, `chat/ChatView.tsx`.

**Risk**

- §5 (scroll clamp) is the only item whose upstream baseline has moved; it must be
  re-reproduced on `develop` before implementation, and may shrink or change shape.
- `MarkdownContent.tsx` is a +265-line rewrite in the fork — the largest blast
  radius here and the one most likely to want its own change if review flags it.
- Everything else is additive or a two-line delegation.

## Discipline Skills

- **`systematic-debugging`** — every defect is asserted against a mechanism
  (missing cleanup path, unavailable Clipboard API, unbounded keyed maps, banner +
  `100dvh` document overflow, pin-clamp scroll event misread as an escape,
  background churn remounting markdown DOM, infinite animation preventing
  compositor idle) and pinned by a red test before the fix. Mandatory for §5,
  whose upstream baseline has changed.
- **`performance-optimization`** — §7 exists to remove ~17 % of a core at idle
  (and ~24.6 % with a background stream); before/after is trace-measured, not
  assumed. §3 is an unbounded-growth fix, not a tuning exercise.
- **`review-code`** — drag-style lifecycle (StrictMode double-invoke, two mounted
  consumers, missed mouseup), timer/listener lifecycle in `useIdleFx`, and the
  timing-sensitive scroll + render-identity changes are all seams that regress
  silently.

`security-hardening` (no untrusted input/secrets/auth surface; the `execCommand`
fallback already exists) and `observability-instrumentation` (no new endpoint, job
or external call) do not apply.
