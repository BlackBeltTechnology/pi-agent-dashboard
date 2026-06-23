## Context

Two surfaces render the same `DashboardSession[]`:

- **Sidebar** — `SessionList.tsx` → `SessionCard.tsx`. Rich status layer.
- **Board** — `OpenSpecBoardView.tsx` → `ProposalCard` → `BoardSessionRow`. Flat status layer.

The sidebar's visual state is driven by a small pure function chain already present:

```
getCardPulseClass(session)            // status → marker class
   "card-input-stripes"  if currentTool === "ask_user"
   "card-working-pulse"  if status === "streaming" || resuming
   "card-unread-pulse"   if session.unread
   ""                    otherwise

getCardStripeFxClass(markerClass)     // marker → overlay color class
   card-working-pulse  → card-stripes-running   (yellow)
   card-unread-pulse   → card-stripes-unread    (cyan)
   card-input-stripes  → card-stripes-input     (purple)
```

The overlay is one `<div className="card-stripes-fx <color>" aria-hidden />` rendered behind content (`relative isolate` parent, overlay at `z-index:-1`). CSS is compositor-only (`transform: translateX(28.2843px)` over a static `repeating-linear-gradient`), already paused under `:root.app-hidden`.

## Goals / Non-Goals

**Goals**
- Board rows + proposal cards read identically to the sidebar for running / unread / ask_user.
- One implementation of the state mapping — no copy-paste drift.
- Board auto-scrolls the active item into view like the sidebar.

**Non-Goals**
- New CSS, keyframes, or protocol fields.
- Virtualization or per-row scroll containers.
- Changing sidebar behavior (helpers relocate but keep semantics + re-exports).
- Error/retry stripes on the board (those flags are chat-panel-local; out of scope).

## Decision 1 — Extract the state mapping into `session-status-visuals.ts`

`session-status-visuals.ts` is already documented as "Single source of truth for status visuals." The three helpers (`getCardPulseClass`, `getCardStripeFxClass`, `STRIPE_FX_CLASS`) currently live in `SessionCard.tsx` only because that was their first consumer. Move them to the lib; `SessionCard.tsx` imports and re-exports for test compat.

```
session-status-visuals.ts  ──exports──▶  getCardPulseClass
                                          getCardStripeFxClass
                                          deriveProposalCardState   (new)
        ▲                       ▲
   SessionCard.tsx        OpenSpecBoardView.tsx
   (re-exports)           (consumes)
```

Rejected alternative: duplicate the mapping in the board. Violates DRY; drift risk when stripe semantics evolve (they already changed once — see `throttle-idle-ui-animations`).

## Decision 2 — Proposal card shows an AGGREGATE state

A proposal card groups N session rows. Painting only row stripes leaves the *card header* (name, state pill, task bar) flat. We aggregate child states into one card-level stripe so a collapsed/scanned card still signals "something here needs attention."

Precedence mirrors `getCardPulseClass`'s internal order (most-urgent wins):

```
deriveProposalCardState(sessions):
   ask_user present   → card-stripes-input    (purple)   ← highest
   running present    → card-stripes-running  (yellow)
   unread present     → card-stripes-unread   (cyan)
   else               → ""                                ← no overlay
```

Open question (capture in spec as a scenario, resolve in review): should an **ended** proposal (all sessions ended, tasks complete) ever stripe? Decision: **no** — completion is already signalled by the COMPLETE state pill + full task bar; a stripe would add noise. `deriveProposalCardState` returns `""` when no child is running/unread/ask_user.

## Decision 3 — Auto-scroll reuses the `SessionList` pattern, not its code

`SessionList`'s scroll effect depends on its own `sessionOrderMap` + `prevSelectedRef` + `firstMountRef` + memoized `scrollFingerprint` (`lib/session-list-scroll.ts`). That fingerprint is sidebar-shaped (re-sort detection). The board's trigger set is different:

```
board scroll triggers:
   selectedId changed to a session that has a row on the board   (deep-link / external select)
   a child session transitioned into ask_user                    (demands attention)
NOT:
   user clicked a row on the board   (they can already see it)
```

So the board gets its **own** small effect: a `useRef` holding the previously-scrolled key, an effect keyed on `[selectedId, askUserFingerprint]` that `querySelector('[data-session-id="…"]')` then `scrollIntoView({ block:"nearest", behavior:"auto" })`. We add `data-session-id={s.id}` to `BoardSessionRow`'s root (the sidebar card already has this attribute; the board row does not yet). Suppress scroll when the change was a user click by comparing against a `lastClickedRef` set in the row's `onClick`.

Rejected alternative: lift `session-list-scroll.ts` to a shared hook. Its fingerprint encodes sidebar re-sort semantics irrelevant to the board; forcing both through one hook couples unrelated trigger logic. A ~15-line board-local effect is simpler and honest.

## Decision 4 — Overlay placement on the board row

`BoardSessionRow`'s root is currently `bg-[var(--bg-secondary)] border rounded-[7px] px-1.5 py-1`. Add `relative isolate` and render the overlay as the first child:

```jsx
<div className="… relative isolate" data-session-id={s.id} …>
  {stripeFx ? <div className={`card-stripes-fx ${stripeFx}`} aria-hidden="true" /> : null}
  {/* existing rows 1–3 */}
</div>
```

`.card-stripes-fx` is `position:absolute; inset:0; z-index:-1; border-radius:inherit` (per `index.css`), so it clips to the row's `rounded-[7px]` automatically and sits behind content. No content markup changes.

`ProposalCard` gets the same treatment on its card root, using `deriveProposalCardState(childSessions)`.

## Risks / Trade-offs

- **Visual noise** if many board sessions stream at once → many yellow cards. Mitigation: same density the sidebar already tolerates; aggregate card state collapses N rows to one card stripe.
- **Light-mode contrast** — stripe colors were tuned for the sidebar card background (`--bg-secondary`/`--bg-surface`). Board row bg is also `--bg-secondary`; card bg is `--bg-tertiary`. Verify the purple/cyan/yellow stripes meet contrast on the card bg; if not, this is a CSS-token follow-up, not a logic change.
- **Test coupling** — relocating helpers could break imports in existing `SessionCard` tests. Mitigation: re-export from `SessionCard.tsx`; run the suite before/after.

## Migration / Compatibility / Rollback

- **Migration**: none. Pure client render change. No server, no protocol, no persisted state.
- **Compatibility**: additive overlays (`aria-hidden`, behind content). Sidebar unchanged. Idle/ended items render nothing new.
- **Rollback**: revert the three touched files. No data to unwind.
