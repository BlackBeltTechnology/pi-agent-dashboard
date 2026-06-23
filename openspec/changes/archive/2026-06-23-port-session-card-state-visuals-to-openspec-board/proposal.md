## Why

`SessionCard.tsx` (sidebar) carries a rich, status-driven visual layer: animated `.card-stripes-fx` scrolling stripes (yellow=running/streaming, cyan=unread, purple=ask_user/needs-input), a status-marker state machine (`getCardPulseClass` → `getCardStripeFxClass`), and — via `SessionList.tsx` — auto-`scrollIntoView` of the active card. The OpenSpec kanban board (`OpenSpecBoardView.tsx`) renders the *same sessions* in its `BoardSessionRow` and groups them under `ProposalCard`, but only borrows the **icon dot + pulse** primitives (`deriveDotColor`, `pulseClassForStatus`). It has **no stripes**, **no aggregate card state**, and **no auto-scroll**.

The result: a session that is streaming, unread, or blocked on `ask_user` is instantly legible in the sidebar but visually flat on the board. A user driving multiple proposals from the board cannot tell at a glance which proposal has a worker that is running, which has unread output, and which is waiting on input — the exact signals the sidebar surfaces. They also cannot rely on the board scrolling the active card into view the way the sidebar does.

This change ports the session-card status-visual logic onto the board so the two surfaces read identically.

## What Changes

- **NEW**: `BoardSessionRow` renders the `.card-stripes-fx` overlay using the **same** `getCardPulseClass` → `getCardStripeFxClass` mapping `SessionCard` uses. Running/streaming → `card-stripes-running` (yellow), unread → `card-stripes-unread` (cyan), `ask_user` → `card-stripes-input` (purple). Idle/ended rows render no overlay (unchanged). The row root gains `relative isolate` so the absolutely-positioned overlay clips to the row.
- **NEW**: `ProposalCard` adopts an **aggregate** card state: it derives the single most-urgent state across its child session rows (precedence `ask_user` > running > unread > none, mirroring `getCardPulseClass`'s internal precedence) and paints the same `.card-stripes-fx` overlay behind the card. A proposal with any blocked worker reads purple; with any running worker, yellow; etc.
- **NEW**: Board auto-scrolls the active item into view, mirroring `SessionList`'s `scrollFingerprint` + `scrollIntoView({ block: "nearest", behavior: "auto" })`. Trigger: the selected session's row (or its enclosing proposal card) becomes selected, OR a child session transitions into `ask_user`. First-mount deep-link to a selected session also scrolls. User-initiated clicks do NOT trigger scroll (matches `SessionList`'s `prevSelectedRef` suppression).
- **NEW**: `BoardSessionRow` inherits the **full** state derivation, not just status. Where the sidebar has chat-panel `hasError`/`isRetrying` flags it uses `deriveDotColorWithFlags`; the board has no chat panel, so it continues to use `deriveDotColor` for the dot BUT additionally consumes `session.unread` and `session.currentTool === "ask_user"` for the stripe layer — the two signals the board currently ignores.
- **NEW**: Shared extraction. The pulse/stripe state mapping (`getCardPulseClass`, `getCardStripeFxClass`, `STRIPE_FX_CLASS`) moves from `SessionCard.tsx` into `packages/client/src/lib/session-status-visuals.ts` (already the single source of truth for dot/icon/pulse) so both `SessionCard` and `OpenSpecBoardView` import one implementation. `SessionCard.tsx` re-exports them for backward compat with existing tests.
- **NEW**: Aggregate helper `deriveProposalCardState(sessions)` in `session-status-visuals.ts` returns the most-urgent stripe class for a proposal card from its child sessions.
- **MODIFIED**: `OpenSpecBoardView.tsx` — `BoardSessionRow` + `ProposalCard` render `.card-stripes-fx`; board mounts a scroll effect; imports moved helpers.
- **MODIFIED**: `SessionCard.tsx` — `getCardPulseClass` / `getCardStripeFxClass` / `STRIPE_FX_CLASS` relocated to `session-status-visuals.ts`; `SessionCard` imports + re-exports.
- **NOT INTRODUCED**: New CSS. The `.card-stripes-fx`, `.card-stripes-running|unread|input` classes already exist in `index.css` (compositor-only `transform: translateX` scroll). The board reuses them verbatim. No new keyframes.
- **NOT INTRODUCED**: New protocol fields. `session.unread`, `session.currentTool`, `session.status`, `session.resuming` already arrive on `DashboardSession`. The board already receives the full session objects.
- **NOT INTRODUCED**: Per-row scroll containers or virtualization. The board uses the existing column scroll; `scrollIntoView({ block: "nearest" })` operates on the existing DOM.
- **NOT INTRODUCED**: Animation when the window is hidden — the existing `:root.app-hidden` play-state pause rule already gates `.card-stripes-fx` globally; board overlays inherit it for free.

## Capabilities

### New Capabilities

- `openspec-board-status-visuals`: the board's parity contract with `SessionCard` — per-row status stripes, aggregate proposal-card state, auto-scroll-into-view of the active item, and the shared-helper extraction that guarantees one implementation across both surfaces.

### Modified Capabilities

None. No existing spec governs the board's status visuals; this adds a new capability. The sidebar `SessionCard` behavior is unchanged (helpers relocate but keep identical semantics and re-exports).

## Impact

- **MODIFIED files**:
  - `packages/client/src/lib/session-status-visuals.ts` — gains `getCardPulseClass`, `getCardStripeFxClass`, `STRIPE_FX_CLASS`, `deriveProposalCardState`.
  - `packages/client/src/components/SessionCard.tsx` — removes the three helper definitions; imports from + re-exports the lib for test compat.
  - `packages/client/src/components/OpenSpecBoardView.tsx` — `BoardSessionRow` + `ProposalCard` render `.card-stripes-fx`; new board scroll effect.
- **NEW files**: none beyond the OpenSpec change artifacts.
- **Backward compatibility**: `SessionCard` visuals unchanged (helpers re-exported). Board adds overlays behind existing content (`z-index: -1`, `aria-hidden`), so layout + a11y tree unaffected. Idle/ended rows render nothing new.
- **Tests**: new unit tests for `deriveProposalCardState` precedence; new board test asserting `.card-stripes-fx` class present for running/unread/ask_user rows and absent for idle; new board test asserting `scrollIntoView` called on selection change but not on user click. Existing `SessionCard` tests pass via re-export.
- **Rollback**: revert the three files; no migration, no persisted state, no protocol change.

## References

- Sidebar status visuals: `packages/client/src/lib/session-status-visuals.ts`, `packages/client/src/components/SessionCard.tsx` (`getCardPulseClass` L57, `STRIPE_FX_CLASS` L74, `getCardStripeFxClass` L78, overlay mounts L518/L633).
- Auto-scroll source: `packages/client/src/components/SessionList.tsx` (`scrollFingerprint` L225, `scrollIntoView` L251), `packages/client/src/lib/session-list-scroll.ts`.
- Stripe CSS: `packages/client/src/index.css` (`.card-stripes-fx` L205, color classes L231/L237/L243; `:root.app-hidden` pause rule). See change: throttle-idle-ui-animations.
- Board target: `packages/client/src/components/OpenSpecBoardView.tsx` (`BoardSessionRow` L706, current icon-only `deriveDotColor`/`pulseClassForStatus` use L719-720). See change: redesign-openspec-board.
- Prior art porting status visuals across surfaces: `add-session-status-to-folder-proposal-rows` (folder pills reuse the same dot/icon primitives).
