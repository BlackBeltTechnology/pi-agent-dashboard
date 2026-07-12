## Context

`ChatView` renders the transcript through `@tanstack/react-virtual` (change
`virtualize-chat-transcript-tanstack`): only `viewport + overscan: 6` rows are
mounted; each row is absolutely positioned and re-measured via
`virtualizer.measureElement` on mount. Finished cards render through
`React.memo` (`MarkdownContent`), so they mount once and stay stable across
reconciliation. The streaming tail is kept always-mounted (never virtualized)
but re-renders its markdown on every chunk.

A browser text selection is a live `Range` bound to specific DOM `Text` nodes.
When those nodes are removed from the document — by an unmount or by a
re-render that replaces them — the browser collapses the selection with no
recovery hook. Auto-scroll follows the bottom via `stickToBottomRef` plus a
virtualizer `onChange` bottom-pin; both set `scrollTop`, which shifts the
mounted window and can unmount a row the user has selected.

Current state: no code path observes the user's selection. `ChatView.tsx` owns
the scroll machine; `packages/client/src/lib/chat-virtual-rows.ts` owns the
row-key/estimate helpers; there is precedent for interaction-aware suppression
(`userSelect` toggles during drags in `ResizableSidebar`, `SplitDivider`,
`useTreeColumnWidth`).

## Goals / Non-Goals

**Goals:**
- Keep an active transcript selection alive across streaming updates, new-card
  arrivals, auto-scroll, and virtual-window churn — normative for finished
  cards, best-effort for the streaming tail.
- One source of truth (`isSelecting`) that gates every churn source, so the
  behavior is coherent and testable.
- Zero behavior change when no selection is active (all `chat-scroll-lock`
  scenarios still pass).

**Non-Goals:**
- Preserving a selection across a session switch or an `event_replay`
  full-transcript rebuild (the anchored nodes are legitimately gone).
- The composer input box (separate surface, separate DOM, unaffected by
  transcript churn).
- Copy-payload correctness (owned by `fix-table-copy-empty-clipboard`); this
  change only keeps the selection alive so native copy works.

## Decisions

### D1: Detect selection via a container-scoped `selectionchange` hook
A new `useActiveChatSelection(containerRef)` subscribes to
`document.addEventListener("selectionchange", …)`, reads `window.getSelection()`,
and sets `isSelecting` true when the selection is non-collapsed AND its **Range
intersects the container** — NOT `container.contains(sel.anchorNode)`. Anchor
containment is one-directional: it misses a selection whose anchor is outside
the container but whose focus is inside (drag started in the composer/header,
released in the chat), and vice versa. Test containment on **both** endpoints
(`contains(anchorNode) || contains(focusNode)`) or use
`range.intersectsNode(container)` / an ancestor check on the range's common
container. It exposes the boolean and the live `Range` (for D3). Updates are
microtask-coalesced (a ref + a single `useState` flip) so a drag-select does
not thrash React.

**Proactive endpoint capture (load-bearing).** The hook MUST record the
selection's row indices into a **ref** the instant selection starts — while the
anchor row is still mounted — and keep it current on every `selectionchange`.
This is what lets D3 keep those rows mounted *before* the virtualizer can
remove them. A purely reactive "read the Range after churn" path loses: per DOM
§live-range-pre-remove-steps, when a row unmounts the browser **synchronously
and irreversibly** moves any Range endpoint inside it to `(spacerParent,
childIndex)`; re-mounting the row later does NOT restore the endpoint. So the
signal D3 consumes must be a continuously-maintained index ref, not a
post-hoc DOM read.

*Alternatives:* pointer-event tracking (`mousedown`→`mouseup`) — rejected: misses
keyboard selection (Shift+Arrow), double/triple-click, and `Select All`.
`selectionchange` is the one event that fires for every selection mutation.
Anchor-only containment — rejected as above (cross-boundary miss).

### D2: Gate the auto-scroll pin on `isSelecting` (Path A, at-bottom)
The `stickToBottom` `useLayoutEffect` and the virtualizer `onChange` bottom-pin
both early-return while `isSelecting`. `stickToBottomRef` is **not** cleared —
it is merely not acted upon — so when the selection collapses, follow resumes
exactly where it was (re-pin only if the user was at bottom). This preserves
every `chat-scroll-lock` scenario because those all run with no selection.

**Resume correctly on collapse (else the user is stranded).** The auto-scroll
effect is keyed on `[messages.length, streamingText, …]`; if the last chunk
arrived *during* the selection and none arrives *after* collapse, the effect's
deps do not change and it never re-fires, leaving the user stuck. Add
`isSelecting` to the effect's dependency array so the `false` transition re-runs
the pin. Also resync `lastScrollHeightRef` to the current `scrollHeight` on the
`isSelecting → false` edge, so the next `onChange` does not read a stale height
and fire a spurious bottom-pin.

*Alternatives:* clearing `stickToBottomRef` on selection — rejected: would leave
the user detached from the bottom after copying, a worse UX than resuming.

### D3: Extend the mounted range via `rangeExtractor` (Path A, multi-card)
Do **not** bolt extra rows on top of `getVirtualItems()`. That approach is
unbuildable: a manually-mounted row still carries `ref={measureElement}`, whose
`resizeItem` writes `itemSizeCache` → `getMeasurements` recomputes every row's
`start` → `getTotalSize()` changes. So "mount extra rows without altering the
spacer" is impossible; worse, `resizeItem` also fires `_scrollToOffset` with a
scroll adjustment when an **above-viewport** row measures larger than its
estimate, jumping the viewport mid-selection.

Instead, feed the virtualizer a custom **`rangeExtractor`** that returns the
default range (`defaultRangeExtractor(range)`) **∪ the selection-intersecting
indices**. The virtualizer then mounts, positions, and measures those rows
itself — correct `start`, correct measurement, no bolt-on positioning math and
no separate `getItemPosition` (which TanStack does not expose cleanly). The
mounted DOM subtrees holding the selected Text nodes stay attached, so the
`Range` survives. `getTotalSize()` changing is accepted as normal virtualizer
behavior (it already changes when the user scrolls a row into view).

**Range → index mapping** walks `range.startContainer`/`endContainer` up to the
nearest `[data-index]`. Endpoints landing in a **non-virtual region** (the
always-mounted streaming tail, pending-steer, pending-prompt — none carry
`data-index`) resolve to `null`; clamp such an endpoint to the nearest virtual
boundary (first/last virtual index) rather than dropping the whole mapping.
Normalize reversed selections (`start > end`) and same-row selections.

**Proactive, not reactive.** `rangeExtractor` runs *inside* the virtualizer's
range computation on every recompute (scroll, resize, count change) — i.e.
*before* it decides what to unmount. If the tracked `[anchor..focus]` span (D1
ref) is always in the extractor's output, the selected rows **never unmount**, so
the synchronous §live-range mutation never fires and the Range stays intact.
This is the whole reason capture must be proactive: mounting after a
`selectionchange` reaction is one commit too late.

**Ceiling = row *span*, device-aware (N_desktop ≈ 100 / N_mobile ≈ 40).** The
extractor retains the entire span `min..max` (not just the two endpoints —
native copy serializes the DOM *between* them, so endpoints-only yields a
silently truncated copy). The cap is therefore on span length. Row-count is a
**coarse interim unit**: rows are 24–220px with heavy subtrees (Prism, xterm,
mermaid, `SubagentDetailView`) plus one `ResizeObserver` each, so ~100 rows is a
~5× jump over the ~18–20-row steady-state and can jank the mobile drag path.
Hence a lower mobile cap (reuse `useMobile()`) and N justified by a **measured**
transient render budget — NOT by "10× under the pre-virtualization baseline"
(that baseline was the cost virtualization removed; it cannot license a new
budget). Revisit to an explicit estimated-size (pixel/node) budget if
measurement warrants.

**Past-N behavior: ACTIVELY clear, never rely on "collapse".** When the span
exceeds the cap (notably `Select All`), *not extending the range does not make
the selection collapse*: start and end sit in **different** removed rows, so each
endpoint moves independently to the spacer parent — the Range persists with
garbage offsets and `toString()` returns silently-wrong text (DOM
§live-range-pre-remove-steps; confirmed by both doubt reviewers). To make the
failure *visible* the view MUST actively `getSelection().removeAllRanges()` at
the cap (optionally a brief "selection too large" hint), OR intercept the `copy`
event. Passive non-extension IS the silent-truncation bug, not a safe fallback.
Full-fidelity large-selection copy is D5's follow-up.

*Alternatives:* raise `overscan` globally — rejected: pays the cost every frame
for a rare interaction and still caps out. Bolt-on extra rows — rejected as
unbuildable (above). Freezing the whole virtualizer range — rejected: TanStack
has no clean "pause". Mount-only-endpoints past N — rejected: silent truncated
copy (above).

### D5: Copy fidelity is a data-model concern — deferred follow-up (scoped honestly)
Mounting a row does not guarantee a correct copy even today: some tool
renderers cap content in the DOM (e.g. `AgentToolRenderer` renders
`text.slice(0, 1000)`), so a fully on-screen selection over them already copies
truncated text — a pre-existing gap independent of virtualization. The follow-up
intercepts the container `copy` event and rebuilds clipboard text for the
selected region, decoupling fidelity from what is mounted.

Two hazards the follow-up must own (surfaced in doubt review), which bound its
scope claims:
- **Partial selections.** A Range can start/end mid-node inside rendered
  markdown. Whole-message serialization over/under-copies. Mapping a DOM offset
  over *rendered* markdown back to a *source* offset is intractable without a
  source map — so the follow-up should extract from the selected DOM
  (`Range.cloneContents()` → text) for partial rows, not reconstruct from
  markdown source.
- **`slice(0, 1000)` is NOT auto-subsumed.** The full prompt text is not in
  `displayRows`/`state.messages` content — it lives on `args.prompt` of the tool
  call. A generic data-model copy still sees 1000 chars. Truly subsuming that
  truncation requires each capping renderer to expose its full text to the copy
  path (per-renderer cooperation); the "subsumes" claim holds only with that
  work, not for free.

Still **out of scope here** (changes the copy contract; touches renderer
serialization). With it, `rangeExtractor` need only keep the visual highlight
alive, not carry copy fidelity.

### D4: Streaming tail (Path B) — best-effort baseline only; real fix deferred
**Do not attempt to freeze the streaming-tail DOM in this change.** The
originally-proposed "hold committed markdown + buffer chunks" is not viable: the
tail is rendered conditionally (`{streamingText && …}`), so at turn completion
`message_end` clears `streamingText`, the tail `<div>` **unmounts**, and any
selection anchored inside it points at a detached node and collapses regardless
of buffering. The buffer also cannot see non-chunk mutations
(`tool_execution_start` flush, `message_end`) that rewrite the same state,
risking dropped or duplicated text.

Scope for THIS change: streaming-tail selection is **no worse than baseline**.
D1–D3 already fix the dominant reported cases (finished-card selections and
at-bottom churn). A real Path B fix (node-stable streaming render) is a
separate follow-up.

*Alternatives considered and rejected for now:* diff-patch the streaming
markdown to preserve nodes (large, fragile); render the tail unconditionally so
it never unmounts (changes turn-completion semantics; out of scope).

## Risks / Trade-offs

- **[`rangeExtractor` mounts extra rows — virtualization budget]** → Bounded by
  the ceiling (D3): only rows the selection intersects, only while selecting,
  capped at a device-aware N (desktop ~100 / mobile ~40). Past the cap the view
  actively clears the selection; it never force-mounts the whole transcript.
- **[Range mutation is synchronous + irreversible on unmount]** → The retained
  span must come from a proactively-maintained index ref (D1) that
  `rangeExtractor` reads on every recompute, so selected rows never unmount. A
  reactive read-Range-after-churn path loses the race (DOM
  §live-range-pre-remove-steps) and cannot be repaired by re-mounting.
- **[Heavy rows on mobile]** → ~100 rows of xterm/Prism/mermaid/`SubagentDetailView`
  can jank a drag on mobile; hence the lower mobile cap and a measured budget,
  not a fixed count justified against the old baseline.
- **[`resizeItem` scroll-anchoring jumps the viewport for above-viewport rows]**
  → When a newly-mounted selection row (above the viewport) measures larger than
  its estimate, TanStack fires `_scrollToOffset` with a scroll adjustment. This
  is TanStack's position-stabilization, not a bug, but it moves `scrollTop`.
  Verify empirically that the selected Text nodes stay attached (they do — the
  row is mounted); if the shift is visually jarring, compensate with the
  measured delta. Task-tracked as an investigation, not assumed benign.
- **[`selectionchange` fires very frequently during a drag]** → Coalesce to one
  React state flip per frame; the boolean rarely changes mid-drag so most events
  are no-ops.
- **[Select-All / whole-transcript Range]** → Range endpoints may land in
  non-virtual regions (streaming tail / pending) with no `[data-index]`; clamp
  to the nearest virtual boundary and apply the ceiling. Document Select-All as
  a known best-effort limitation rather than force-mounting the transcript.
- **[Row-index mapping from a `Range` is DOM-structure-sensitive]** → Handle the
  null-endpoint (non-virtual region), reversed, and same-row cases explicitly;
  unit-test the `Range → row-index set` helper in isolation.

## Migration Plan

Pure client-side, additive. No data model, protocol, or persistence change; no
migration or rollback beyond reverting the client commit. Ships behind the
natural feature boundary (the new hook). Path B (streaming tail) is already
split out as a follow-up; D1–D3 ship independently.

## Open Questions

- **Resolved (doubt review):** Path B (streaming-tail freeze) is out of scope —
  best-effort baseline only, real fix deferred to a follow-up (see D4).
- **Resolved (doubt review):** the mounted-set mechanism is `rangeExtractor`,
  not bolt-on rows; the "getTotalSize unchanged" invariant is dropped as
  impossible (see D3).
- Should `isSelecting` also suspend the `onChange` re-pin when the selection is
  in the streaming tail but the user is still at bottom, or only when it is in a
  scrolled-up finished card? (Leaning: suspend in both — simpler, one rule.)
- **Resolved (explore + doubt):** ceiling is a device-aware *span* (desktop
  ~100 / mobile ~40); past-N the view MUST actively clear the selection
  (`removeAllRanges`) — it does NOT passively collapse (that silently truncates).
  Capture must be proactive so selected rows never unmount. See D1 + D3.
- **Resolved (explore):** copy fidelity for large selections / truncated tool
  DOM (`slice(0, 1000)`) is a data-model copy-intercept problem, deferred to a
  follow-up. See D5.
