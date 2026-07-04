# Design — Reasoning Auto-Collapse Timer

## The core problem: live vs replay provenance

Live streaming and replay run through the **same reducer**. Replayed history fires
`thinking_start → thinking_delta → thinking_end` too (via `replayEntriesAsEvents` /
`ln.ts`), producing an identical `role:"thinking"` message. The message object carries
no signal that it was just streamed live. During replay all three events collapse inside
one synchronous batch, so the user never even sees the streaming block.

The distinction exists only at the dispatch layer (`useMessageHandler.ts`):

```
 case "event"          → live   → reduceEvent(state, ev)        one at a time
 case "event_replay"   → replay → reduceEvent loop over batch   type: event_replay
```

So "live-streamed reasoning" ≡ "the thinking message whose `thinking_start` we rendered
as a live streaming block." The design threads that provenance from the dispatch layer to
the rendered block.

## Chosen approach: provenance flag on the message (reducer param)

Add an optional `isLive` boolean to `reduceEvent`. The live path passes `true`; the
`event_replay` loop passes `false` (or omits → default replay-safe `false`). At
`thinking_end`, when `isLive`, set `streamedLive: true` on the new thinking message.

```
 reduceEvent(state, event, { isLive })     // isLive default false
   thinking_end:
     msg = { role:"thinking", content, startedAt, duration,
             streamedLive: isLive === true }
```

Why a reducer param and not a transient id-set on state:
- The reducer already owns thinking_end message creation; the flag is intrinsic message
  provenance, so it belongs on the message.
- `event_replay` re-replay / reconnect naturally never sets it — no extra bookkeeping to
  clear a set on reset. Replay-idempotency (re-replay overwriting messages) keeps
  `streamedLive:false` for historical blocks.
- Default `false` is replay-safe: any code path that forgets to pass `isLive` degrades to
  "no timer," never to "spurious timer on history."

## Rendering + timer (ThinkingBlock)

`ThinkingBlock` gains two props: `streamedLive?: boolean`, `autoCollapseMs?: number`.

```
 mount:
   expanded = useState(streamedLive)   // live ALWAYS mounts expanded; replay collapsed.
                                       // (0 = stay open: timer, not initial state, is
                                       //  what 0 disables)
   timerRef   = useRef(null)
   touchedRef = useRef(false)
   msRef      = useRef(autoCollapseMs) // captured; NOT a dep (see W1)

 useEffect (deps [streamedLive]):     // NOTE: autoCollapseMs deliberately NOT a dep
   clearTimeout(timerRef.current)
   if (touchedRef.current) return               // user owns the block; never auto-touch
   if (!streamedLive) { setExpanded(false); return }   // demoted to replay → collapse (C2)
   if (msRef.current > 0):
     timerRef.current = setTimeout(() => {
       if (!touchedRef.current) setExpanded(false)
     }, msRef.current)
   return () => clearTimeout(timerRef.current)

 onToggle (user click):
   touchedRef.current = true       // permanently cancels the timer
   clearTimeout(timerRef.current)  // ref-held handle, cleared imperatively here
   setExpanded(v => !v)
```

**Polarity (fixes an inversion caught in review).** `initialExpanded` is `streamedLive`
alone. Gating it on `autoCollapseMs !== 0` would render a live block *collapsed* when the
pref is `0`, the opposite of "0 = stay open until clicked." The `> 0` check belongs only in
the timer-arming condition. Replayed block (`streamedLive` falsy) → mounts collapsed, no
timer → identical to today.

**React to demotion, don't just clean up (fixes CRITICAL C2, cross-model cycle 2).** On a
WebSocket reconnect the `event_replay` full-sweep (`shouldReset`) wipes `SessionState` and
rebuilds every message via the replay path → the previously-live thinking message is
recreated with `streamedLive:false`. React matches the stable key `thinking-N`, so the
`<ThinkingBlock>` instance **does not remount** — its props merely update `true→false`.
Because `useState(streamedLive)` ignores post-mount prop changes, a naive "cleanup clears
the timer" design leaves the block **stuck open forever**. The effect above keys on
`streamedLive` and, on the `→false` transition, actively calls `setExpanded(false)` (unless
the user touched it). Semantically right: after a reconnect the block IS history, so it
collapses. A block mid-window at reconnect collapses slightly early rather than hanging
open — accepted.

**Timer vs `touched` (fixes an ambiguity caught in review).** The timer handle and
`touched` live in **refs**, not state; the arming effect does NOT depend on `touched`. The
click handler clears the handle imperatively, so a user-pinned block is not re-armed by an
effect re-run.

**Mid-window pref change (fixes W1, cross-model cycle 2).** `autoCollapseMs` is captured in
`msRef` and is deliberately absent from the effect deps. Editing the global pref while a
block is counting down does NOT restart its timer from full duration; the new value applies
to blocks that mount afterward. (Trade-off: an in-flight block ignores a mid-window pref
edit. Acceptable — the alternative is elapsed-time bookkeeping for a rare interaction.)

**StrictMode.** The effect is idempotent under double-invoke: cleanup clears any prior
timer before arming, so a dev-mode double mount cannot leak two timers.

**Polarity (fixes an inversion caught in review).** `initialExpanded` is `streamedLive`
alone. Gating it on `autoCollapseMs !== 0` would render a live block *collapsed* when the
pref is `0`, the opposite of "0 = stay open until clicked." The `> 0` check belongs only in
the timer-arming condition. Replayed block (`streamedLive` falsy) → mounts collapsed, no
timer → identical to today.

**Timer vs `touched` (fixes an ambiguity caught in review).** The timer handle and
`touched` live in **refs**, not state, and the arming effect does NOT depend on `touched`.
The click handler clears the handle imperatively, so a user-pinned block is not re-armed by
an effect re-run. This avoids the "once vs deps" contradiction: the effect arms on
mount/pref-change; `onClick` is the sole canceller.

- Replayed block: `streamedLive` falsy → mounts collapsed, no timer → identical to today.
- Live block, pref > 0: mounts open, collapses after `autoCollapseMs`.
- Live block, pref `0`: mounts open, timer never armed → stays open until click.
- Reconnect while a live block is open: `streamedLive` demotes to false → block collapses
  (becomes history). Never stuck open.
- Any manual click sets `touchedRef` → timer cancelled forever; auto-behavior only applies
  to blocks the user never interacted with.

### Collapse DURING streaming is preserved (C1, cross-model cycle 2 — DECIDED: lift into state)

The live streaming block (`state.streamingThinking`) and the committed message block are
two distinct `<ThinkingBlock>` instances, so a manual collapse on the streaming instance
would otherwise die at `thinking_end` and the committed block would pop back open. Decision:
**lift the collapse into `SessionState`** so user intent survives the swap.

Mechanism:
- Add `streamingThinkingCollapsed: boolean` to `SessionState`; `thinking_start` resets it
  to `false` (alongside the existing `streamingThinking = ""` reset).
- The streaming `<ThinkingBlock>` at `ChatView.tsx:555` gets an `onUserCollapse` callback;
  when the user collapses it, ChatView dispatches a client-only signal that sets
  `streamingThinkingCollapsed = true`. (A local reducer action / setState on the session
  map — no server round-trip; this is view state.)
- At `thinking_end`, if `streamingThinkingCollapsed` is true, the committed message is
  created with `streamedLive: false` (mounts collapsed, arms no timer) — honoring the
  collapse. Otherwise `streamedLive: isLive` as before. Reset
  `streamingThinkingCollapsed = false` after flush.

Net: collapsing mid-stream yields a committed block that stays collapsed with no timer;
not collapsing keeps the hold-open-30s behavior. ~15 lines across `event-reducer.ts`
(state field + reset + thinking_end branch) and `ChatView.tsx` (callback wiring).

### key stability caveat (review finding #7)

The persisted thinking message id is positional — `thinking-${messages.length}`
(`event-reducer.ts:1136`) — and `ChatView` uses it as the React `key`. If a future change
reorders/inserts messages before a thinking row, the block **remounts**, resetting
`touchedRef` and re-arming the timer. Today the `message_end` reorder pass does not reorder
committed thinking rows, so this is latent, not active. Implementation MUST NOT change the
id scheme as part of this work; a task verifies no remount occurs across a normal turn.
ChatView is not virtualized, so scroll does not unmount — `touched` survives scrolling.

### streaming-block invariant

The live streaming block (`ChatView.tsx:555`, `state.streamingThinking`) MUST NOT receive
`streamedLive`/`autoCollapseMs`. It has no `key` and is reused as one fiber across
consecutive thinking blocks in a turn; leaking auto-collapse props onto it would carry
`touched`/timer state across blocks. Only the persisted `role:"thinking"` block gets the
new props.

Per-block, uniform: each live block arms its own timer from its own mount. Multi-step
turns stagger naturally. No "latest block only" logic.

### Why mount-expanded is safe for the swap

The live streaming block (`state.streamingThinking`) unmounts at `thinking_end`; the
persisted block mounts the same frame. Because the persisted block mounts **expanded**
when `streamedLive`, there is no visible collapse flicker at the swap — the reasoning stays
open continuously from streaming into the hold window.

## Preference

`DisplayPrefs.reasoningAutoCollapseMs: number` (default `30000`).

- `mergeDisplayPrefs`: `override.reasoningAutoCollapseMs ?? global.reasoningAutoCollapseMs`.
- Presets (`simple` / `standard` / `everything`): all default `30000`. (Independent of the
  `reasoning` boolean — a hidden reasoning block simply never renders, so the timer is
  moot when `reasoning:false`.)
- `0` = never auto-collapse (stay open until clicked). The existing `reasoning:false`
  already covers "hide entirely," so the full range is: hidden / hold-open / auto-collapse.
- Surfaced in `SettingsPanel` (numeric/seconds field) and, if desired, the per-session
  `ChatViewMenu` popover.

### Persistence path (review findings #2, #3, #6) — the load-bearing correction

The pref is NOT free on the server. Two edits in `packages/server/src/preferences-store.ts`:

1. **`setDisplayPrefs` (`:465`)** hand-builds `merged` field-by-field from an all-false
   `base`; it does not call `mergeDisplayPrefs`. Add
   `reasoningAutoCollapseMs: partial.reasoningAutoCollapseMs ?? base.reasoningAutoCollapseMs`
   (and `30000` in the `base` fallback literal). Without this, every
   `PATCH /api/preferences/display` returns + broadcasts a `DisplayPrefs` with the field
   `undefined`, wiping the client's `global` mid-session.
2. **Load path (`:218`)** reads `data.displayPrefs` verbatim. Legacy `preferences.json`
   files predate the field. Backfill on load: when `displayPrefs` exists but lacks
   `reasoningAutoCollapseMs`, set it to `30000`. This is the single chokepoint that
   guarantees the client always receives a number — `useDisplayPrefs`
   (`global ?? DISPLAY_PRESETS.standard`) only substitutes the preset when `global` is
   wholly absent, so an existing object missing one field would otherwise surface
   `undefined`.

The timer formulas (`> 0`) tolerate a stray `undefined` (degrades to "no timer"), but the
documented "default 30000" is only honored if the backfill lands. Both server edits are
mandatory, not optional.

### Call sites of `reduceEvent` (review finding #5)

Three callers, all must be accounted for:

| Site | File | Passes |
|---|---|---|
| Live | `useMessageHandler.ts:298` (`case "event"`) | `{ isLive: true }` |
| Replay | `useMessageHandler.ts:511` (`case "event_replay"` loop) | omit → default `false` |
| Rehydrate | `rehydrate-session.ts:33` (cold-load from persisted cache) | omit → default `false` |

Rehydrate is a replay path by nature, so the default `isLive=false` is correct (no timer on
cold load). The default MUST be `false` precisely so an unenumerated future caller degrades
to replay-safe, never to a spurious live timer.

## Alternatives considered

- **Transient `recentlyStreamedThinkingIds` set on state** — works, but adds set lifecycle
  (clear-on-reset) and is redundant with putting provenance on the message. Rejected for
  the reducer-param approach.
- **Component-only (always mount expanded, always time out)** — rejected: replayed history
  would all flash open→collapse on cold load, violating the "only live" requirement.
- **Collapse on "next content" instead of wall clock** — richer, but the user chose a
  simple fixed per-block timer with no last-in-turn exception; a content-driven trigger
  adds jitter and complexity we explicitly ruled out.

## Test surface

- Reducer: `thinking_end` with `isLive:true` sets `streamedLive:true`; with `isLive:false`
  (and via `event_replay`) sets/leaves `streamedLive` falsy.
- Replay idempotency: re-replay of a historical thinking block keeps `streamedLive` falsy.
- `mergeDisplayPrefs`: numeric override precedence; default `30000`; `0` preserved.
- Server `setDisplayPrefs`: a PATCH that omits `reasoningAutoCollapseMs` preserves the
  stored value (does not reset to `undefined`).
- Server load: a legacy `preferences.json` with `displayPrefs` but no
  `reasoningAutoCollapseMs` loads as `30000`.
- ThinkingBlock (RTL + fake timers): live block collapses after `autoCollapseMs`; `0`
  renders **expanded** and never collapses; manual click before expiry cancels the timer;
  replayed block never arms; block does not remount (touched/timer survive) across a
  normal streaming→commit→next-block turn.
