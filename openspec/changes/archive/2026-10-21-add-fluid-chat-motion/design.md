# Design: add-fluid-chat-motion

## Context

See proposal.md (Why). The current state that shapes the approach:

- **Bursty input.** The bridge coalesces streaming text into 50 ms windows (`packages/extension/src/message-update-coalescer.ts:48`). The client folds bursts per frame (`chat-event-render-batching`).
- **Whole re-parse per update.** The streaming tail renders `<MarkdownContent content={streamingTailText}>` outside the virtual list (`packages/client/src/components/chat/ChatView.tsx:2174-2186`). `MarkdownContent` is one `ReactMarkdown` pass with `rehypeRaw` → `rehypeSanitize` (`packages/client/src/components/preview/MarkdownContent.tsx:630`, `:656`, `:714`). Prose linkification only processes direct string children of `p`/`li` (`MarkdownContent.tsx:123-131`, `:287-292`). Live reasoning is rendered the same way (`ThinkingBlock.tsx:185`, fed at `ChatView.tsx:2154-2157`).
- **Scroll writers and attribution.**
  - Two bottom-pin writers both do `el.scrollTop = el.scrollHeight` behind `stampProgrammaticScroll` (`:546`) and record a single-use `pinnedSnapshotRef`. One is the content `useLayoutEffect` (`ChatView.tsx:1676-1699`, deps `messages.length, streamingText, pendingPrompt, streamingThinking, pendingSteering, isSelecting`). The other is the virtualizer `onChange` grow-pin (`:1300-1313`). The tail is excluded from `getTotalSize()` (`:1292-1293`).
  - `handleScroll` (`:1459-1515`) classifies each event in this order: jump → pin-clamp → in-flight descent (`descendingRef`) → ascent → the position rule `stickToBottomRef = nearBottom` (`SCROLL_THRESHOLD = 50`, `:401`).
  - Real wheel/touch input runs `cancelDescent` (`:1446-1456`, bound to `onWheel` and `onTouchMove` at `:1821`), which drops the programmatic tag and the snapshot.
  - `scrollToBottom` is deliberately `"instant"` while streaming, because a native smooth scroll fixes its target at call time and races chunks (`:1547-1561`).
  - A `replayInFlight` prop exists (`ChatView.tsx:154`, `:473-493`). The attribution contract (`openspec/specs/chat-scroll-lock/spec.md`, "Auto-scroll robust to multi-batch event replay") lets a bottom-pin write claim the position it achieved; an event matching it preserves follow, any other falls through. That is how scrollbar drags and keyboard scrolls escape without an input event.
- **Animation pauses.** `:root.app-hidden *` (`index.css:773-775`) and `:root.fx-idle *` (`index.css:796-798`) force `animation-play-state: paused`. The idle mark applies after `IDLE_FX_DELAY_MS = 5000` with no deliberate input. A user watching a stream without touching anything is "idle" within 5 s.
- **Live vs replay in the reducer.** The reducer is pure over events. `opts.isLive` exists (`lib/chat/event-reducer.ts:1846-1848`) but is a weak signal (`:2342-2344`). The optimistic prompt is set outside the reducer and carries no id (`hooks/useSessionActions.ts:259-268`: `{text, images, delivery, status, …}`). Pending steering is an App prop of type `string[]` (`App.tsx:2565`), keyed by index + text prefix (`ChatView.tsx:2206-2207`).
- **Second consumer.** `packages/team-app/src/agent/ChatPane.tsx:98` mounts `ChatView` via `chat-embed` without `replayInFlight`/`loadingHistory`. Motion applies there too, and arrival detection must not depend on those props alone.
- **In-instance completion detection precedent.** `ToolBurstGroup` detects the running→done flip inside one component instance to play `tool-group-flash` once (`ToolBurstGroup.tsx:186-198`, `:257`). A remount starts in the done state and does not flash.
- **Tail selection freeze.** While a selection is held in the tail, `frozenTailText` snapshots the tail and the committed twin is hidden after `message_end` (`ChatView.tsx:888-900`, `:1112-1118`, `:1211-1228`, `:1412`).
- **Display-prefs plumbing.** Shared type, presets and merge are in `packages/shared/src/display-prefs.ts` (`toolGroupDefaultCollapsed` at `:163`, `DISPLAY_PRESETS` from `:240`, `mergeDisplayPrefs` from `:325`). Server construction sites are in `packages/server/src/persistence/preferences-store.ts`: the backfill (`:347-360`) and the `setDisplayPrefs` base + per-field merged literals (`:1107-1145`). The precedent UI is `ChatViewMenu.tsx:201` plus `settings/SettingsPanel.tsx`, where Settings defers until Save.

## Goals / Non-Goals

**Goals:**
- Arrival-driven motion. Nothing animates without new content, nothing is left hidden, and behaviour never waits on motion.
- One switch (`chatMotion`, reduced motion, or a hidden document) that yields today's exact behaviour.
- The reducer and the event pipeline are untouched.

**Non-Goals:**
- Bridge coalescing, protocol, or server event changes.
- `MinimalChatView` and plugin-rendered tool cards.
- Exit animations.
- Animating history, replay, session switches, or remounts.
- Changing the streaming caret.

## Decisions

### D1 — Substrate: transitions, `@starting-style`, and frame-driven JS; never CSS keyframes

Entry, completion cue and trailing-edge fade use CSS transitions, with `@starting-style` for initial values. Paced reveal and the glide are frame-driven JS (rAF).

`animation-play-state: paused` only affects CSS animations, so the `fx-idle` / `app-hidden` marks cannot freeze content mid-motion. Every element's static style is its settled, fully visible state.

`@starting-style` is Baseline 2024 (Chromium 117+). On older engines the element simply appears.

Rationale for not honouring `fx-idle`: the idle mark fires 5 s after the last input, i.e. during nearly every watched stream. Tying motion to it would disable the feature exactly where it matters. The motion here is arrival-driven and bounded: zero work when nothing arrives. That differs in kind from the continuous decoration the idle pause targets. This is made explicit through a MODIFIED `ui-animation-energy` requirement (D9) rather than left as a silent interpretation.

### D2 — Live-arrival detection in the view, not the reducer

The reducer is not touched. `arrivedAt` stamping is rejected: it breaks `chat-event-render-batching` byte-identity and replay equivalence, and it misses the optimistic prompt and steering, which are not reducer rows.

**Replay-aware consumers only.** Entry transitions and completion cues (D7) run only when the consumer supplies the `replayInFlight` prop. The dashboard does (`App.tsx:2565`); the team-app `ChatPane` does not (`ChatPane.tsx:98`). Replay cannot be told from live there, so it gets pacing, the trailing edge and the glide, but no entry or completion cue. This is deterministic, not heuristic.

**Seen-set for keyed elements (tool rows, group members).**
- One `Set<toolCallId>` per `ChatView` instance (a ref, never module-level).
- It is **reset and re-seeded on every switch into a session**, i.e. the first commit whose `sessionId` differs from the previous commit's. It is also re-seeded on the commit where motion becomes active. Ids that arrived while a session was not shown, or while motion was off, never animate.
- Ids are recorded from the **unfiltered** session state (the tool-call map, incrementally by insertion order), not from display rows. Toggling a display filter therefore never makes ids "new".
- Recording runs only while motion is active, so the motion-off cost is exactly today's.
- Recording happens in a layout effect after each commit, whether or not the row is mounted. An off-screen arrival is recorded and never animates when scrolled into view later. Virtualizer remounts never animate.

**Edge detection for unkeyed elements.** The pending-prompt card, the streaming answer bubble, the inline live reasoning bubble, and steering (as a multiset of `text` occurrences) are entering iff absent from this instance's previous commit **for the same session id**. Steering removals simply drop out of the multiset, so a later identical steer text animates again.

**Entering decision, in render (reads only).** An element is entering iff it is new (per the rules above) **and** live-follow holds:
- motion active and the consumer is replay-aware;
- following (scroll button hidden);
- no selection held (synchronous `isSelectingRef`);
- not `replayInFlight` / `loadingHistory`;
- **the commit is not bulk**, i.e. it adds at most 4 new elements plus status flips (defence in depth: replay arrives as many rows at once, live streaming adds 1–2 per frame).

**Latched per instance.** The result is captured in `useState(() => entering)` and the class stays on that element instance. `@starting-style` acts only at first style resolution, so the latched class never re-triggers, and removing it can never cut a transition short.

**Re-parenting.** A group is entering only if **all** member ids are new. A group formed from visible members does not animate; a new member joining a visible group animates only its own line.

**Never eligible:** committed user, assistant and reasoning message rows. Commit swaps do not animate, and the pending-card → confirmed-card swap keeps its zero-layout-shift contract. If a swap happens mid-entry, the replacement appears at full opacity (a brief pop). Accepted.

*Alternative rejected:* a pure time window at mount. Mount latency leaks entries onto remounts and re-parented groups.

### D3 — Paced reveal: `usePacedText(target, { active, frozen })`

Both instances live in `ChatView`: the answer tail, and live reasoning when rendered **inline-flow** (`prefs.reasoningInlineFlow`). The capped reasoning mode (`ThinkingBlock.tsx:181`, inner 400 px scroller, the default) renders as today: reveal inside an inner scroller is out of sight and buys nothing. `ChatView` passes the revealed reasoning text to `ThinkingBlock`, so both revealed lengths are pin triggers.

- **Step per frame:** `n = max(BASE_CPS·dt, backlog·(1 − e^(−dt/τ)))`, with τ = 120 ms, `BASE_CPS ≈ 90/s`, the fraction carried over, and `dt`-based, so it is frame-rate independent. The step extends to the next whitespace, capped at 48 chars. This is cosmetic.
- **Deadline rule (what bounds the lag).** Received deltas are queued as `(endOffset, arrivedAt)`. Entries older than `DEADLINE = 400 ms` are compacted into one `mustShow` offset, so the queue is bounded even during a long freeze. Every step raises shown to ≥ `mustShow`. A `setTimeout` armed for the oldest pending entry's deadline forces a step even if rAF is throttled while the document is still "visible". The exponential term alone is asymptotic: simulated, a 400-char dump takes ≈ 533 ms.
- **`active`** = motion on AND document visible AND following the bottom AND (for reasoning) inline-flow and expanded.
- **Whenever `active` is false, the hook returns `target` and syncs its state:** shown = target.length, queue cleared. Re-activation therefore never hides text the user already saw. A target that shrinks or resets (new turn, `thinking_start`) clears the queue and syncs too.
- **`frozen` takes precedence over the snap and sync rules, and over a hidden document.**
  - It is driven by the synchronous selection clock (`isSelectingRef`, the same one the pin effect reads, `ChatView.tsx:1679-1685`), checked inside the rAF step, so no reveal step runs after a drag starts.
  - For the answer tail it is today's freeze (always on): `frozenTailText` now snapshots the **revealed** text.
  - For inline live reasoning the freeze is new and **only while motion is active**. With motion off, reasoning behaves as today.
  - On unfreeze, the deadline rule shows everything older than 400 ms at once and the rest flows.
- **Snap to `target`:** when backlog > 4000 chars, or when the shown text is no longer a prefix of `target`, unless frozen.
- **Lifecycle unchanged.** At `message_end` / `thinking_end` the live element unmounts as today and the committed row renders full content. The residual backlog (≤ 400 ms of text) snaps. A reasoning selection across `thinking_end` is lost exactly as today; the freeze holds "until collapse or block completion".
- **rAF only while backlog > 0.** In-flight backlog (≤ 400 ms of received text) is not yet rendered and so not selectable or copyable. That is the definition of pacing, carved out in the spec.

### D4 — Render cost: measure first, then escalate in a fixed order

Pacing raises tail renders from per burst (~20/s) to up to per frame. A trace gate runs inside the paced-reveal task group (tasks §4), immediately after pacing is wired and before any other motion work. Everything ships in one PR, so a failed gate is fixed in place before review. It compares a ≥ 4000-char code+list answer with motion on vs off. The budget is **both**:
- p95 main-thread frame time during streaming < 16 ms;
- tail scripting time within 1.5× of motion off.

If over budget, escalate in this order, re-measuring after each step:
1. Cap the reveal cadence at 30 Hz: a reveal *step* every ≥ 33 ms, each step rendered. Coherent: reveal and render stay 1:1.
2. Parser-based block split. Run `remark-parse` (no rehype, no React) on the tail to get top-level node offsets. Memoize completed top-level blocks as separate `MarkdownContent` instances and re-render only the last. Boundaries come from the parser, so indented code, tables, blockquotes, HTML blocks and loose lists are never mis-split. Caveat to handle: the mermaid ordinal (`remarkMermaidOrdinal`) needs a per-block starting offset.

With motion off, cost is exactly today's. **If the budget is still exceeded after step 2**, pacing (and so the trailing edge) is disabled, while T1/T4/T5 stand. That is a scope change, so `ship-it` escalates via `SHIP_IT_BLOCKED.md` rather than deciding alone.

### D5 — Fresh-text softening: trailing-edge mask, not spans

The markdown tree is never modified, so linkification, sanitize, selection and copy are unaffected.

- After each reveal commit, a layout effect finds the last rendered text node in the tail (`TreeWalker`, skipping `pre`/`code`/`.mermaid`/`.katex`; if the reveal point itself is inside inline `code`, the overlay is hidden for that step, because its background differs) and measures its last client rect with a `Range`.
- An absolutely positioned overlay inside the bubble (`pointer-events: none`, `aria-hidden`) is moved there with `transform`. It is ≈ 2.5 em wide, one line tall, and carries `linear-gradient(to right, transparent, var(--bg-tertiary))`. The newest glyphs therefore appear softened at the reveal point and become crisp as it advances.
- The overlay is visible only while revealing. When the backlog empties it fades out via an opacity transition (≈ 200 ms), and it is removed when the reveal is inactive, frozen or ended, or when the last block is code/diagram/math (the background cannot be matched there).
- The overlay lives inside the streaming bubble, which is already `position: relative` via `.chat-stream-live`. It is painted beneath that bubble's `::before`/`::after` liveness layers, so the shimmer sweeps text and overlay alike. It is skipped when the computed `direction` is `rtl`.
- One `Range` measurement per reveal step is a layout read right after a commit that already invalidated layout. It is included in the D4 gate.

*Alternative rejected:* fresh-text spans (FlowToken style). They break linkification (`MarkdownContent.tsx:123-131`), and they re-fade on markdown restructuring (`**x`→`<strong>`, list formation).

### D6 — Glide follow-scroll: an attributed follow writer

- **One pin function.** Both pin writers route through `pinBottom(kind)`.
  - **Glide** only for `kind === "live"`: the content/reveal layout effect firing for the **same session id** as its previous run, on a non-bulk commit. It also requires motion active, Δ ≤ `clientHeight`, no selection, not `replayInFlight`/`loadingHistory`, and not ascending/descending.
  - The virtualizer `onChange` grow-pin is `kind === "measure"`. **While a glide is in flight it re-targets the glide only if every existing `onChange` guard passes** (`ChatView.tsx:1310`: follow, no selection, no splice suppression) **and** the remaining Δ ≤ `clientHeight`. Otherwise it cancels the glide and does today's instant write. Without a glide it is today's instant write.
  - Everything else is today's instant write.
- **The glide.** An exponential follow toward the live bottom: `scrollTop += Δ·(1 − e^(−dt/τg))` with τg = 60 ms, `dt`-based so it is frame-rate independent, and snapping when |Δ| < 2 px. Settle time ≈ τg·ln(Δ/2): ≈ 140 ms for 20 px, ≈ 360 ms for 800 px. The target is re-read every frame, so there is no native-smooth race.
  - *Rejected:* the `use-stick-to-bottom` velocity spring. With fixed per-frame steps it is frame-rate dependent, and it settles in 0.6–1.1 s, which breaks the idle-exemption bound and lets entries finish off-screen.
- **Attribution: each glide step is a bottom-pin write under the existing contract.** Each step writes `scrollTop`, stamps `"pin-bottom"`, and records `pinnedSnapshotRef = {top: achieved, height}`. `handleScroll` is **unchanged in classification**: an event matching the achieved position (sub-pixel tolerant, content not shrunk) holds follow via the existing clamp branch, and any other event falls through to the position rule. A scrollbar drag, keyboard scroll, middle-click autoscroll, or find-in-page moves the view off the achieved position, so it fails the match and releases follow, with no input binding needed. Because scroll events dispatch before rAF callbacks in a frame, the handler sees the foreign position first.
- **One addition to the fall-through path:** a fall-through while a glide is in flight cancels the glide before the next step. `cancelDescent` (wheel, touchmove) also cancels it. Every relocation writer, a selection start, a session change, and motion becoming inactive (one instant pin) cancel it too. No extra input bindings and no hold state.
- The button: during a glide the matching events take the clamp branch, which leaves button state untouched. The button was hidden because the view was following, so it stays hidden. `chat-scroll-lock` is clarified accordingly (D10).

### D7 — Tool completion cue: in-instance flip, compositor-only

`ToolCallStep` (and the burst header via its existing flip detection) keeps the previous status in a ref. Only when it observes running→`done` or running→`error` **in the same instance**, on a live-follow, non-bulk commit, in a replay-aware consumer (D2), and not `elided`, does it:
- mount the status icon (done check or error alert, per existing severity styling) with an `@starting-style` scale/opacity transition, replacing `tool-group-flash` in that case;
- give a result body shown by that flip an opacity + small translate entry.

There is no height transition and no `.group-collapse` wrapper, so layout with motion off is unchanged and nothing animates a layout property. A remount, a replay or a later manual expand never cues.

### D8 — `chatMotion` preference: every construction site

- **Shared:** type, all three presets (default `true`), merge.
- **Server:** load backfill **and** both `setDisplayPrefs` literals, matching their shape (`partial.chatMotion ?? base.chatMotion`; the base literal sets `chatMotion: true` as a documented exception to its all-`false` booleans, because the default is on), so a PATCH that omits the field preserves it and `PATCH {chatMotion:false}` persists. This is the runtime rollback path.
- **UI:**
  - View-popover row, instant apply, override marker.
  - Settings chat-display toggle, deferred until Save.
  - Two i18n keys, following the precedent namespaces: `common.chatMotion` (View popover, like `common.keepToolGroupsCollapsed`) and `settings.chatMotion` (Settings). Both go in the en source (`i18n-en-source.json`) and every locale bundle; `scripts/i18n-parity.mjs` must stay green.
- **Effective motion** = `chatMotion && !prefers-reduced-motion && document visible`. It is read via one hook subscribed to the media query and to `visibilitychange`, and passed down. A CSS reduced-motion guard strips chat-motion transitions as a second layer.

### D9 — MODIFIED `ui-animation-energy`: a bounded exemption for arrival-driven chat motion

Framed as a **bounded exemption**, like the existing spinner exemption, not as a redefinition of "continuous". During a watched-but-untouched stream the idle mark is set after 5 s. Pacing and the glide then do schedule frames for the whole stream. That is the point: the user is looking at content that is arriving, the same justification the spinner exemption uses.

The bound is measurable: no chat-motion frame callback later than **1 s after the last content arrival**. Reveal completes ≤ 400 ms after the last arrival (deadline); the glide settles ≤ ~360 ms after the last growth; transitions are ≤ 300 ms. The exemption never applies while hidden or scroll-locked. Observable: while pacing, the glide or the trailing-edge overlay schedules frames, `chat-scroll-container` carries `data-chat-motion-busy`. The attribute is removed when they stop, and the e2e idle-exemption scenario asserts on it.

### D10 — MODIFIED `chat-scroll-lock`: glide steps are attributed bottom-pins; no button mid-glide

Two requirements gain clarifications; their existing text is otherwise verbatim.
- **"Auto-scroll robust to multi-batch event replay"** adds that a follow-glide step is a bottom-pin write for attribution purposes. It claims the position it achieved; matching events preserve follow; any other event falls through, and a fall-through ends the glide. The escape paths (input clears it, a position mismatch falls through) are unchanged.
- **"Scroll-to-bottom button"** states that a glide in progress is not scroll-lock, so intermediate positions more than 50 px from the bottom do not show the button.

## Risks / Trade-offs

- [Glide in a scroll-race hotspot] → it reuses the existing attribution contract instead of a new latch: each step is an attributed bottom-pin, so every foreign scroll falls through exactly as today. Every relocation and input cancels it. With motion off the code path is today's. Scenarios cover wheel-up, scrollbar drag, keyboard, a session switch, jump-to-message and scroll-to-top mid-glide. The existing scroll-lock, virtualization and selection suites must stay green.
- [Render cost of pacing] → the D4 gate runs before T3/T4 land, with a fixed escalation order. The global pref is a runtime off switch.
- [Trailing mask colour mismatch over inline code or highlights] → it covers ≈ 2.5 em at the reveal point only, is hidden over code/diagram/math blocks, and fades out at rest. Accepted.
- [CJK text without whitespace] → the 48-char step cap bounds steps. Purely cosmetic.
- [Residual backlog snaps at `message_end`] → ≈ τ of text. Accepted.
- [The seen-set grows with long sessions] → ids only, instance-scoped. Negligible next to the transcript itself.
- [The bulk guard (≤ 4 new elements per commit) could suppress a legitimate live burst, e.g. 5 parallel tool calls in one frame] → they appear without entry. This is a safe failure (no motion, never wrong motion). Accepted.
- [team-app gets no entry or completion cues] → deterministic choice (D2); it can adopt them later by passing `replayInFlight`. team-app falls back to `DISPLAY_PRESETS.standard`, so motion is on there and only OS reduced motion disables it. Accepted.
- [A pending card confirmed within 300 ms pops to full opacity mid-entry] → brief, rare. Accepted.
- [A per-session override `chatMotion: true` survives a global runtime rollback] → it is an explicit user choice. The operator kill switch is the global PATCH plus clearing overrides via the existing per-session Reset. Documented.

## Migration Plan

- Additive pref, backfilled to `true` at every server construction site. Older clients ignore it.
- Runtime rollback: `PATCH /api/preferences/display {"chatMotion": false}`. Code rollback: revert; no persisted state besides the pref field.
