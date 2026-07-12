## Context

Follow-up to `reduce-chat-render-cpu-umbrella` Phase 2 Step B. Baseline trace (from the umbrella): main-thread ~100% on a 768-message session; **GC 20.7 s**, **25 827 listeners**, **46 918 DOM nodes**, heap peak 190 MB. Step A (`content-visibility: auto`) bounds layout+paint but leaves nodes mounted, so GC and listeners are untouched. This change unmounts off-screen rows.

Current `ChatView.tsx` render (line 330-331): a single scroll container `<div ref={scrollRef} onScroll={handleScroll} style={{overflowAnchor:"auto"}}>` wrapping `groupedMessages.map((item: BurstItem) => …)`. `groupedMessages = groupToolBursts(filteredMessages)` yields heterogeneous rows:
- `type:"burst"` → `<ToolBurstGroup>` (keyed by `burst.id`)
- `type:"group"` → `<CollapsedToolGroup>` (keyed by first-member id)
- otherwise a `ChatMessage` → role-branched bubble / card

Hand-rolled scroll machinery to be replaced:
- `stickToBottomRef` (bool) + `SCROLL_THRESHOLD` near-bottom detection in `handleScroll`.
- `useLayoutEffect` sticky-bottom chase (line 278) — scrolls to `scrollHeight` when pinned.
- `useLayoutEffect` per-session save/restore of raw `scrollTop` (line 247).
- `ChatViewHandle.scrollToTurn` via `querySelector('[data-turn]')` (line 308).
- Browser `overflowAnchor:"auto"` for history-prepend stability.

## Goals / Non-Goals

**Goals:**
- Mounted DOM nodes, event listeners, and React fibers bounded by viewport working set (+overscan +streaming tail), independent of session length.
- Reproduce every `chat-scroll-lock` scenario exactly (50px threshold, button, replay race).
- `ChatViewHandle` API byte-identical; `scrollToTurn` works for off-screen turns.
- Streaming tail always rendered; no visible jump on stream growth while pinned.
- GC and heap materially reduced on a long session vs. Step A (measured).

**Non-Goals:**
- Restoring Cmd-F find over off-screen rows (known regression; separate follow-up).
- Changing per-row rendered output (markdown/mermaid/tool cards unchanged).
- Server/protocol/replay changes (replay path already batches).
- Horizontal or grid virtualization.

## Decisions

**Decision 1 — TanStack v3 chat mode, not manual windowing.**
Use `useVirtualizer({ anchorTo:'end', followOnAppend:true, scrollEndThreshold:50, overscan:6, getItemKey:(i)=>rows[i].id, estimateSize, getScrollElement })`. Chat mode natively provides end-anchoring, follow-on-append-only-when-pinned, streaming-tail size-delta pinning, and keyed history-prepend stability — the four behaviors ChatView hand-rolls. `scrollEndThreshold:50` matches `chat-scroll-lock` (overrides guide default 80). `getItemKey` uses each row's existing stable `id` (never the array index — required by chat mode for prepend stability).
- Alternative: keep the manual scroll code, virtualize only rendering. Rejected: two competing anchoring systems (browser `overflowAnchor` + manual chase + virtualizer) will fight; delete the old machinery.

**Decision 2 — Row model is unchanged; the virtualizer windows `groupedMessages`.**
`count = groupedMessages.length`. Each virtual item renders the same burst/group/message branch as today, wrapped in an absolutely-positioned measured div:
```tsx
{virtualizer.getVirtualItems().map(vi => (
  <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement}
       style={{position:'absolute', top:0, left:0, width:'100%',
               transform:`translateY(${vi.start}px)`}}>
    {renderRow(groupedMessages[vi.index])}
  </div>
))}
```
Total height = `virtualizer.getTotalSize()` on a spacer. `data-turn` attributes stay on rendered rows for any DOM-level consumers, but `scrollToTurn` no longer depends on them (Decision 4).

**Decision 3 — Streaming tail is never virtualized.**
The last row(s) carrying `streamingText`/`streamingThinking`/`pendingSteering` render **outside** the virtual window (or are force-included in overscan) so they are always mounted and always measured. Chat-mode size-delta pinning then keeps the bottom stuck as the tail grows. This directly satisfies the spec's "streaming tail always rendered" scenario and avoids re-mounting a rapidly-growing row.
- Mechanism candidate: render the virtual window for indices `[0, n-1)` and the final streaming row(s) as a static sibling below the spacer; or `rangeExtractor` that always appends the last index. Pin exact mechanism in implementation; both keep the tail live.

**Decision 4 — `scrollToTurn(turnIndex)` → `scrollToIndex(rowIndex)` via a turn→row map.**
Build `turnToFirstRowIndex: Map<number, number>` in the same `useMemo` that produces `groupedMessages` (each row already knows its originating turn). `scrollToTurn(t)`:
```ts
const rowIndex = turnToFirstRowIndex.get(t);
if (rowIndex == null) return;
stickToBottomRef.current = false;      // escape follow (unchanged intent)
setShowScrollButton(true);
virtualizer.scrollToIndex(rowIndex, { align:'start' });
```
`ChatViewHandle` signature is untouched — only the body changes. Off-screen turns now work because `scrollToIndex` scrolls *then* mounts, rather than querying an unmounted node.

**Decision 5 — Per-session scroll persistence in virtual coordinates.**
Replace saved `{scrollTop, nearBottom}` with `{anchorRowIndex, offset, nearBottom}`. On session switch: if `nearBottom` → `scrollToEnd()` in a `useLayoutEffect`; else `scrollToIndex(anchorRowIndex, {align:'start'})` then apply `offset`. Capture `anchorRowIndex` from `virtualizer.getVirtualItems()[0]?.index` on switch-away. Raw `scrollTop` is meaningless once the total size is estimated, so it cannot be reused across a remount.

**Decision 6 — Height stability: reserve, always-measure, re-test.**
- `estimateSize`: derive from measured real message-height distribution (umbrella task 4.1 already collects this) — a per-row-type estimate (single bubble vs. burst group) beats one global constant and reduces first-paint offset error.
- Images: set intrinsic width/height (or `aspect-ratio`) so a row's height is known before load; otherwise an above-viewport image load shifts offset.
- Mermaid: render into a container with a reserved min-height; accept one re-measure after async render, but keep it below the fold impact by reserving space.
- Tool-group expand/collapse: `measureElement`'s ResizeObserver re-measures automatically; chat-mode adjusts offset. Verify expand of an above-viewport group does not yank the viewport.

**Decision 7 — Verification is trace-diff + the `chat-scroll-lock` suite.**
Re-record the umbrella baseline scenario. Gate on: mounted DOM nodes bounded (target < ~2–3k on the long session vs. 46.9k), listeners bounded, GC time materially down, heap peak down; AND every `chat-scroll-lock` scenario green (automated where possible). No merge if any scroll-lock scenario regresses.

## Risks / Trade-offs

- [Cmd-F find breaks over off-screen rows] → inherent to windowing; document for ship; scope in-app search / print-expand as a separate follow-up. This is the main reason the umbrella ordered Step A first.
- [Above-viewport async resize (image/mermaid) jumps scroll] → reserve intrinsic size (Decision 6); measure jitter on an image-heavy session in verification.
- [`chat-scroll-lock` replay race reproduced incorrectly] → port the exact 50px + programmatic-scroll-suppression scenarios into the virtualized path; keep the `chat-scroll-lock` scenario tests as the gate.
- [Streaming row re-mount thrash if accidentally virtualized] → Decision 3 forces it always-live; add a test asserting the streaming row stays mounted across window changes.
- [Two anchoring systems fighting during migration] → delete `stickToBottomRef` chase + `overflowAnchor` reliance in the same change; do not layer virtualizer on top of the old chase.
- [`scrollToTurn` align/offset differs subtly from old getBoundingClientRect math] → snapshot old vs new landing position on a fixture; `align:'start'` chosen to match current top-align intent.

## Migration Plan

Pure client change. Add `@tanstack/react-virtual`, migrate `ChatView.tsx`, delete superseded scroll machinery, deploy via `npm run build` + `POST /api/restart`. Rollback = revert the diff (returns to Step A `content-visibility`). No data/protocol/persistence-format migration. Depends on `reduce-chat-render-cpu-umbrella` having landed (Phase 4 memo + `chat-transcript-virtualization` capability + Phase 1/3 so trace numbers isolate the windowing win).

## Test Strategy

Validation splits by layer; do not over-trust jsdom.

- **Unit (vitest, mockable) — already written.** `packages/client/src/lib/__tests__/event-reducer.batch-fold-invariant.test.ts` proves the reducer property the *umbrella's* Phase 3 leans on (fold split-invariance + order-sensitivity). Step B's own unit layer: the `turnToFirstRowIndex` map (`scrollToTurn → scrollToIndex`) is a pure function — unit-test it directly (Step B task 5.2). Prop-identity (Phase 4) is referential-equality, also unit-mockable.
- **Browser (Playwright, NOT mockable) — skeleton already written.** `tests/e2e/chat-transcript-virtualization.spec.ts` holds 6 `test.fixme` tests, one per `chat-scroll-lock` + `chat-transcript-virtualization` requirement (50px lock, scroll-to-bottom button, multi-batch replay, off-screen `scrollToTurn`, streaming-tail-mounted, bounded row count). jsdom cannot validate any of these (no layout), so this is the authoritative gate. Section 9 tasks unblock and activate it.
- **Trace (perf-diff, not assertable).** DOM/listener/GC reduction and idle busy % — re-record + diff (task 10.1). No unit or e2e assertion substitutes.

**`long-transcript` faux scenario (Step B task 9.1).** The e2e layer needs a deterministic transcript long enough to (a) exceed several viewports (force a >50px scroll-up for the lock tests) and (b) make windowing observable (bounded-mounted-rows test). Shape: ~400+ heterogeneous messages streamed through the normal faux pipeline (assistant text + thinking + tool calls, mirroring `burst-heterogeneous` but N× longer), with an exported tail marker so the streaming-tail assertion has a stable target. Lives in `qa/fixtures/faux-scenarios.ts` alongside the existing scenarios; no new harness plumbing.

## Doubt-Review Corrections (cycle 1 — single-model Claude + cross-model GPT-5)

An adversarial review (both architectures converging) disproved several premises in Decisions 1-6. These corrections **supersede** the conflicting parts above.

- **CR-1 (supersedes D1's "delete the scroll machinery").** TanStack handles ONLY windowing of historical rows + history-prepend anchoring. The existing DOM-measured scroll state machine is **PRESERVED, not deleted**: `handleScroll` (50px near-bottom), `stickToBottomRef`, `showScrollButton`, the instant-vs-smooth scroll-to-bottom behavior (`ChatView.tsx:236`), and the multi-batch `event_replay` race handling (incl. the 150ms user-scroll arbitration) all stay, measuring the REAL container. Do NOT rely on the virtualizer's `followOnAppend`/`isAtEnd` for bottom-pinning. This resolves findings 3, 4, and the 150ms-gap.
- **CR-2 (supersedes D3).** The streaming tail, `pendingSteering`, AND `pendingPrompt` already render as siblings OUTSIDE `groupedMessages` (`ChatView.tsx:575-610,629-655`) — so they are naturally never virtualized. They stay as static siblings BELOW the `getTotalSize()` spacer. Because the virtualizer's `getTotalSize()` excludes them, bottom-pin logic MUST be DOM-measured (per CR-1), not virtualizer-measured. `rangeExtractor` is NOT used for the tail (the tail isn't in `count`).
- **CR-3 (supersedes D2's "each row has a stable id").** `ToolCallGroup` (`type:"group"`) has no `id` field. `getItemKey` must be a per-type function mirroring the current render keys: `burst.id` | `group.messages[0]?.id ?? group.toolName` | `msg.id`. The `toolName` fallback can collide across two sub-threshold bursts of the same tool → synthesize a stable per-instance id (e.g. first-member id required; if absent, `"group-"+firstMemberIndex`). Uniqueness is a hard precondition for `anchorTo:'end'` measurement caching.
- **CR-4 (supersedes D4's "each row knows its turn").** `turnIndex` is assigned ONLY to the last user message (`event-reducer.ts:~1600`), not to burst/group rows. `turnToFirstRowIndex` is still buildable: scan the display-row list for rows whose underlying `ChatMessage.turnIndex === t` (the same rows that render `data-turn` today) and map `t → that row index`. Build it on the FILTERED display list (see CR-5), not raw `groupedMessages`.
- **CR-5 (new — supersedes the implicit "count = groupedMessages.length").** Prefs-gated / suppressed rows (`return null` at ~7 sites: `prefs.reasoning`, `prefs.toolCalls`, `hiddenToolResultIds`, `retriedErrorIds`, `surfaceSuppressedIds`, debug tools) must be filtered OUT into a `displayRows` array UPSTREAM of the virtualizer, so `count === displayRows.length` and no index reserves empty spacer space. `getItemKey`, the turn map, and persistence all key off `displayRows`.
- **CR-6 (supersedes D5's index-based persistence).** Persist the anchor by stable ROW ID, not array index (indices shift under head-trim/filter). Capture the first NON-overscan visible item (not `getVirtualItems()[0]`, which may be an overscan row); on restore, resolve id→current index then `scrollToIndex`.
- **CR-7 (refines D6 — trade-off, not clean win).** `ChatImage` carries only `{data, mimeType}` — no dimensions. `aspect-ratio` reservation needs either decode-time dimension capture (extra plumbing) or is downgraded to a reserved `min-height` that accepts ONE reflow per image as it loads. Accepted trade-off: reserve min-height; document the single-reflow-per-image cost; revisit dimension capture only if history-scroll jitter fails its e2e gate.

Net effect on scope: the virtualizer's role shrinks to "window the historical `displayRows` + anchor history-prepends"; everything bottom-anchored stays on the existing, preserved DOM scroll machine. This is lower-risk than the original "chat mode replaces it all" framing and keeps every `chat-scroll-lock` scenario driven by the code that already passes it.

## Open Questions

- Exact streaming-tail inclusion mechanism (static sibling vs. `rangeExtractor` force-append) — pin at implementation against the always-mounted test.
- Does `overscan:6` suffice for fast wheel scrolling on this content mix, or does markdown re-parse on rapid mount cause blank flashes > 1 frame? Tune against the "scrolling back through history" scenario.
- Is a single scroll container correct, or does the sticky toolbar / `FilePreviewHost` need the virtualizer's scroll element re-parented? Verify `getScrollElement` targets the same node `scrollRef` does today.
