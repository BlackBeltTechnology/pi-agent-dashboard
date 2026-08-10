## Context

The folder header carries three independent liveness elements: a raw `(N)` session count, `FolderNeedsYouPill` (purple, clickable, owns the widget-bar probe), and `FolderStatusRollup` (working/idle dot-counts, **collapsed-only**). D2 of the archived `add-folder-actions-menu` design collapses them into one severity-ordered capsule.

The existing derivation layer is `packages/client/src/lib/session/session-status-visuals.ts`:

- `StatusShape = "needs-you" | "working" | "idle" | "error" | "notice" | "ended"` — **six** shapes, not the four D2 names.
- `deriveStatusShape(session, flags)` needs per-session flags `{ hasError, isRetrying, hasWidgetBarPrompt, hasNotice }`.
- `countStatusRollup(sessions)` calls `deriveStatusShape` **with no flags** (line 199) and then keeps only the `working` / `idle` shapes (lines 200-201). Error and notice are unreachable through it because their flags are never supplied; needs-you *is* derivable flagless (`deriveStatusShape` returns `needs-you` for a chat-routed `ask_user` when `hasWidgetBarPrompt` defaults false) but is discarded by the filter — and would be wrong anyway, since it would count the widget-bar-placed prompts the pill deliberately excludes.
- `countNeedsYou(sessions, isWidgetBar)` exists separately and takes the widget-bar predicate.

Colour tokens are **two disjoint families** (`index.css`): `--status-{needs-you,working,idle,error,notice}` (lines 69-75) are the semantic session-status tokens the SessionCard dot, `FolderStatusRollup` and `FolderNeedsYouPill` all consume; `--severity-{error,warning,success,info,neutral}-{bg,fg,border}` (lines 77+) are documented as the "single color source of truth for every toast / banner surface". They are not interchangeable: severity has no purple member, and its warning tier is `--accent-orange` where `--status-working` is `--accent-yellow`.

The status flags are already available at the folder level: `SessionList` receives `errorSessionIds`, `retrySessionIds` and `noticeSessionIds` as `Set<string>` props from `App.tsx:1325` and threads them per card (`SessionList.tsx:1509`) — but not, today, into the folder header. The widget-bar classification is *not* a prop — `FolderNeedsYouPill` obtains it by mounting one hidden `WidgetBarProbe` per `ask_user` candidate, because `useHasWidgetBarPrompt` is a hook and cannot be called in a loop over a varying list. The header row also carries its own `onClick` (directory-home navigation), which is why the existing pill calls `e.stopPropagation()` (`FolderNeedsYouPill.tsx:74`).

## Goals / Non-Goals

**Goals:**

- One capsule per folder, rendering in both collapse states, replacing all three elements.
- Fixed severity order needs-you > error > working > idle, independent of magnitude.
- Non-idle segments navigate to the first session in that state; idle is inert.
- No new colour tokens, drawn from the **`--status-*`** family; no change to how session status is *computed*.

**Non-Goals:**

- Changing `deriveStatusShape` semantics or the per-card dot/rail rendering.
- Introducing a folder-level error source. This change consumes the sets `App.tsx` already computes.
- Any tier-0 banner work (D4–D7) or slot-pill work (D9/D10) — separate changes.
- Persisting or filtering by capsule state.

## Decisions

### D-A: One counting function, flags-aware — `countStatusCapsule`

`countStatusRollup` is replaced by `countStatusCapsule(sessions, flags)` where `flags` supplies the same per-session predicates `SessionCard` already uses: `errorSessionIds`, `retrySessionIds`, `noticeSessionIds`, and a widget-bar classification. It returns `{ needsYou, error, working, idle }` **plus the first session id per bucket**, so the segment's navigation target is computed in the same pass that computes the count and cannot disagree with it.

**The widget-bar input is tri-state, and needs-you is NOT delegated to `deriveStatusShape`.** A `(id) => boolean` predicate cannot distinguish *not widget-bar* from *not yet classified*, and collapsing them re-introduces the exact over-count flash `FolderNeedsYouPill` was written to avoid (`classified.get(s.id) === false` — absent means excluded). But making the parameter tri-state is not sufficient, because `deriveStatusShape` **cannot carry it**: it forwards to `isChatRoutedAskUser(session, hasWidgetBarPrompt = false)`, whose default coerces `undefined` → `false` → `!false` → `needs-you`. Feeding an unclassified candidate through the shared derivation therefore reproduces the flash exactly.

`countStatusCapsule` consequently owns an explicit needs-you predicate rather than delegating:

```
needsYou(s) := s.currentTool === "ask_user"
            && s.status !== "ended"
            && !errorSessionIds.has(s.id)      // error outranks needs-you
            && widgetBar(s.id) === false
```

The `!errorSessionIds` clause is **load-bearing and easy to omit**: `isChatRoutedAskUser` does not check `hasError`, because `deriveStatusShape` checks it first (line 148, ahead of line 149). Reproducing the predicate without re-adding that guard double-counts an errored `ask_user` session in both segments and makes the needs-you segment navigate to a session whose card dot is red — breaking the capsule/card lockstep this design asserts.

and **any `ask_user` session that is widget-bar-placed or not-yet-classified is excluded from every bucket**, not merely from needs-you. Letting such a session fall through to `deriveStatusShape` with `hasWidgetBarPrompt: true` yields `idle` — a session the user must answer in the widget bar would be counted green and "all clear". Today it is invisible in the header; exclusion preserves that. `deriveStatusShape` itself is untouched (Non-Goal), and remains the derivation for the error / working / idle buckets.

**Sessions are pre-filtered before shape derivation**, not after: `status === "ended"` (because `deriveStatusShape` checks `flags.hasNotice` at line 153 *before* the status check at 154-155, so a stale-notice ended session would otherwise land in a live bucket) and `hidden === true` (`group.sessions` demonstrably contains hidden sessions — `SessionList.tsx:1266`'s cleanup count re-filters `!s.hidden` precisely because the group list does not). Hidden is what the user chose to suppress; re-surfacing it in a folder-level count undoes that choice. Note this is *not* universally "unreachable": with `showHidden` on, hidden sessions do render as cards, so in that mode the capsule deliberately counts fewer sessions than the folder body displays. Accepted — the alternative couples a pure counting function to a view toggle.

**`notice` is folded into `idle` at the counting boundary.** Now that the flags are supplied, `deriveStatusShape` reaches its `notice` branch (line 153) where the flagless `countStatusRollup` never could. The capsule has no `notice` bucket, so `countStatusCapsule` must map `notice` → `idle` explicitly. Without that mapping a noticed session falls out of every bucket and the idle count silently drops below today's — the fold is what preserves parity, not an aesthetic choice, and it is stated in the spec rather than only here.

**Counting order and navigation order are the same list — the folder's `group.sessions` order**, minus the exclusions above. Deliberately *not* the body's rendered order: `visibleSessions` (`SessionList.tsx:1363-1404`) is computed inside the body IIFE, out of scope at the header, and is reactive to the search box, the tag filter and the per-folder `urgencySort` toggle. Counting over it would make the capsule's numbers change when the user types in the search box, and would let a filtered-out state show a count with no reachable target. Today's pill navigates from raw `group.sessions` order; keeping that is status-quo-preserving and needs no refactor. The consequence — with urgency sort on, the target may not be the topmost visible card — is accepted and matches today.

*Alternatives rejected:* (a) keep `countStatusRollup` and add a second call for error — two passes that can disagree, and it leaves the flagless-derivation gap in place; (b) compute counts in the component — untestable without mounting, and the existing file is the established pure/unit-testable home.

### D-B: `notice` folds into `idle`, `ended` is excluded — status-quo-preserving

D2 names four buckets but the taxonomy has six shapes. `ended` is excluded (as `FolderStatusRollup` already does). `notice` — the only-reasoning terminal case from `fix-gemini-subagent-silent-tool-schema-failure` — is **not** given its own segment: a fifth segment would dilute the capsule for a state the user cannot act on from the folder header.

It folds into `idle`, which is **exactly what happens today**: `countStatusRollup` derives flagless, so a noticed session already reports as `idle` in the rollup and is already non-navigable there (the rollup is not clickable at all). Folding is therefore no regression — it preserves current behaviour rather than discarding a signal the folder header ever carried. The per-card blue `--status-notice` dot is untouched and remains the place `notice` is legible.

*Alternative rejected:* a fifth `notice` segment — fails D2's whole premise (fewer elements, stronger signal). *Alternative rejected:* folding into `error` — `notice` is explicitly the non-error informational state.

### D-C: The widget-bar probe pattern is preserved verbatim

The needs-you count must keep excluding widget-bar-placed prompts, and `useHasWidgetBarPrompt` is a hook. The capsule therefore keeps `FolderNeedsYouPill`'s existing mechanism — one hidden `WidgetBarProbe` per `ask_user` candidate, keyed by session id, reporting up into a `Map<string, boolean>` — moved into the capsule component unchanged. Unclassified candidates stay **excluded** until their probe reports, so the capsule never flashes an over-count.

*Alternative rejected:* lifting widget-bar state into `App.tsx` alongside `errorSessionIds`. Cleaner in principle, but it widens the change into the app shell for no behavioural gain and risks a render-order regression in the one path that is already correct.

### D-D: Segment order is a constant, not derived

The order is a module-level constant array `["needsYou", "error", "working", "idle"]`. Rendering maps over it and skips zero counts. Magnitude never reorders. This makes "needs-you before error" a one-line invariant a test can assert directly, rather than an emergent property of sort logic.

### D-E: No responsive shedding — the name absorbs the squeeze, as it does today

An earlier draft had the capsule shed idle → working → error under width pressure. That is **unsatisfiable as specified**: the capsule is `flex: none` alongside the action cluster, and the folder-name spans are the row's only shrinkable children (`flex-[0_1_auto] min-w-0`). A non-shrinking element never experiences width pressure to react to, and a container query on itself can never fire; only a sidebar-width media query could, which would shed segments on folders that had ample room.

The capsule therefore sheds nothing: it is non-shrinking, non-wrapping, and the folder name truncates — identical to how the pill and rollup behave today. Simpler, and it keeps the highest-value counts always visible.

*Alternative rejected:* `ResizeObserver`-driven shedding — real but disproportionate: a resize-loop hazard and a second layout pass to save a few pixels on a control that already fits.

### D-F: Accessibility — labelled buttons, inert idle

Each non-idle segment is a `<button>` with a full-sentence `aria-label` ("4 sessions blocked on you — go to first"), per the archived plan's constraint that segments must not be one ambiguous target. The idle segment renders as a `<span>` — not a disabled button, which would still be announced as an unavailable control. The capsule as a whole carries no group `aria-label`, to avoid the screen reader reading the counts twice; this drops the single grouped label `FolderStatusRollup` provides today, in exchange for per-segment labels that name both count and state.

The inert idle `<span>` still carries its own `aria-label` naming the state ("3 idle"); without one a screen reader announces a bare number, which is worse than the grouped label being dropped.

**Activation semantics are inherited from the existing pill, not reinvented**: `e.stopPropagation()` (the header row has its own `onClick`, and its link semantics make nesting controls order-sensitive), expand the folder when collapsed, `onSelect(id)`, then scroll into view.

One correction to the inherited gesture: the pill's single `requestAnimationFrame(scrollIntoView)` can fire before React commits the expanded body (cards mount only under `{!isCollapsed && …}`), leaving `querySelector` null and the scroll a silent no-op. The pill got away with it on one path; the capsule extends the gesture to three segments.

Rather than hand-rolling a replacement, activation routes through the **reveal machinery `SessionList` already owns** — `revealRequest` / `onSeekToCard` / `findLaidOutCard` (`SessionList.tsx:772-940`), which already handles guarded expand, layout-settled detection, a backstop timer, and degrade messaging when the target is filtered out. That last part matters here: the capsule counts and targets from `group.sessions`, which ignores the active search/tag filter, so a segment can legitimately target a card the current filter hides. Reusing the existing path gets that case handled instead of silently no-oping.

## Risks / Trade-offs

- **[Folding `notice` into `idle` hides a real anomaly at folder level]** → Not a regression: the flagless rollup already buckets notice as idle today. The per-card dot still shows `notice`. Accepted because the capsule is a triage surface, not a diagnostic one. Revisit if `notice` frequency rises.
- **[`countStatusRollup` has callers beyond the rollup]** → Mitigated: task 1.1 enumerates callers before deletion; if any survive, keep the old function and add the new one rather than widening the blast radius.
- **[Removing the raw `(N)` count loses "how big is this folder"]** → Accepted trade-off. Note the sum of segments does **not** reproduce it: every bucket excludes ended sessions while the raw count included them, so the sum is lower for any folder with history. What survives is the folder's existing `N ended` disclosure row plus the live segment counts. An all-ended folder, which shows `(N)` today, will show no capsule at all. Flagged for the human — this is the most visible removal in the change.
- **[Threading the status flags into the folder header is new plumbing]** → `errorSessionIds` / `retrySessionIds` / `noticeSessionIds` reach `SessionList` today but stop at the session cards; the header composition needs them. Small, but it is a prop-flow change, not a pure component swap.
- **[Excluding hidden sessions changes today's counts]** → The outgoing pill and rollup both count hidden sessions (they receive raw `group.sessions`). Excluding them lowers some counts, and is a deliberate correction: a hidden session cannot be navigated to, so counting it advertises an unreachable target. Called out because it is a behaviour change in a change whose premise is re-presentation.
- **[Capsule counts do not react to the session search / tag filter]** → Accepted, and status-quo: the pill and rollup are equally filter-blind. The alternative (count `visibleSessions`) makes folder liveness change as the user types.
- **[The needs-you probe mechanism moving components could regress the count]** → Mitigated: move the mechanism verbatim, and port `FolderNeedsYouPill`'s existing tests onto the capsule before deleting the component.
- **[Segments as buttons increase tab stops per folder]** → Accepted: up to 3 extra stops per folder, against the alternative of an ambiguous single target. Idle stays inert precisely to cap this.

## Migration Plan

1. Add `countStatusCapsule` alongside `countStatusRollup`; unit-test it flags-aware.
2. Add `FolderStatusCapsule`, absorbing the `WidgetBarProbe` mechanism.
3. Swap the header composition in `SessionList` — capsule unconditional on collapse state; delete the raw `(N)` render.
4. Delete `FolderNeedsYouPill` + `FolderStatusRollup` and `countStatusRollup` once no caller remains.
5. Migrate unit + E2E consumers to the new segment test ids.

Rollback is a revert: the change is client-only, adds no persisted state, and no server or wire contract moves.

## Open Questions

1. **Does any surface outside the folder header consume `FolderStatusRollup` or `countStatusRollup`?** Task 1.1 resolves this before deletion.
2. **Is the widget-bar exclusion visible enough?** A widget-bar-blocked session is invisible in the capsule (as it is in today's header). That is status quo, but it means the capsule can read "all idle" while a session waits for input in the widget bar. Out of scope to fix here; worth a follow-up if it bites.

Resolved since the first draft: `retrySessionIds` counts as **working** (matching `deriveStatusShape`, which treats `isRetrying` as `working`) — now stated in the spec rather than left open; hidden sessions are **excluded** — `group.sessions` demonstrably contains them.
