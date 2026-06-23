## 1. Extract shared state-mapping helpers

- [x] 1.1 Move `STRIPE_FX_CLASS`, `getCardPulseClass`, `getCardStripeFxClass` from `packages/client/src/components/SessionCard.tsx` into `packages/client/src/lib/session-status-visuals.ts`. Keep signatures identical.
- [x] 1.2 In `SessionCard.tsx`, import the three from the lib and re-export them (`export { getCardPulseClass, getCardStripeFxClass } from "../lib/session-status-visuals.js";`) so existing test imports resolve unchanged.
- [x] 1.3 Add `deriveProposalCardState(sessions: DashboardSession[]): string` to `session-status-visuals.ts`. Returns the most-urgent `card-stripes-*` class via precedence: any `currentTool === "ask_user"` → `card-stripes-input`; else any `status === "streaming" || resuming` → `card-stripes-running`; else any `unread` → `card-stripes-unread`; else `""`.
- [x] 1.4 Tests in `packages/client/src/lib/__tests__/session-status-visuals.test.ts`: `deriveProposalCardState` precedence (ask_user beats running beats unread beats none); empty array → `""`; all-ended → `""`.
- [x] 1.5 Run existing `SessionCard` / `ChatViewMenu` suites → green via re-export.

## 2. Per-row stripes on the board

- [x] 2.1 In `OpenSpecBoardView.tsx`, import `getCardPulseClass`, `getCardStripeFxClass` from `../lib/session-status-visuals.js`.
- [x] 2.2 In `BoardSessionRow`, compute `const stripeFx = getCardStripeFxClass(getCardPulseClass(s));`.
- [x] 2.3 Add `relative isolate` to the row root className and `data-session-id={s.id}` to the root element.
- [x] 2.4 Render `{stripeFx ? <div className={`card-stripes-fx ${stripeFx}`} aria-hidden="true" /> : null}` as the first child of the row root (behind content).
- [x] 2.5 Verify no content layout shift (overlay is `position:absolute; inset:0; z-index:-1`).

## 3. Aggregate stripes on the proposal card

- [x] 3.1 In `ProposalCard`, gather the child sessions already rendered as `BoardSessionRow`s.
- [x] 3.2 Compute `const cardStripeFx = deriveProposalCardState(childSessions);`.
- [x] 3.3 Add `relative isolate` to the card root; render the `.card-stripes-fx ${cardStripeFx}` overlay (when non-empty) as first child, mirroring task 2.4.
- [x] 3.4 Confirm the overlay sits behind the existing selected-border styling and task bar.

## 4. Auto-scroll the active item into view

- [x] 4.1 Add a board-level `useRef` `lastClickedRef` set in `BoardSessionRow`'s `onClick` (`lastClickedRef.current = s.id`) BEFORE calling `onNavigateToSession`.
- [x] 4.2 Build an `askUserFingerprint` (e.g. sorted ids of sessions with `currentTool === "ask_user"`) memoized from the board's session set.
- [x] 4.3 Add a board `useEffect` keyed on `[selectedId, askUserFingerprint]`: if the triggering change was NOT a user click (`selectedId !== lastClickedRef.current`), `querySelector(`[data-session-id="${selectedId}"]`)` and call `scrollIntoView({ block: "nearest", behavior: "auto" })`. Guard for missing element.
- [x] 4.4 First-mount deep-link: on initial mount with a `selectedId` present on the board, scroll once (mirror `SessionList` `firstMountRef`).
- [x] 4.5 Reset `lastClickedRef.current = null` after the effect runs so the next non-click selection scrolls.

## 5. Tests

- [x] 5.1 Board test: a running session row carries `card-stripes-running`; unread → `card-stripes-unread`; `ask_user` → `card-stripes-input`; idle → no `.card-stripes-fx` child.
- [x] 5.2 Board test: a `ProposalCard` with one ask_user child + one running child shows `card-stripes-input` (precedence) on the card root.
- [x] 5.3 Board test: changing `selectedId` to a session not previously clicked calls `scrollIntoView`; a row click does NOT call `scrollIntoView`.
- [x] 5.4 Board test: an all-ended proposal renders no card-level `.card-stripes-fx`.

## 6. Verification

- [x] 6.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|✗' /tmp/pi-test.log` → no new failures.
- [x] 6.2 Manual: open the board with a streaming session → row + card stripe yellow; trigger ask_user → purple; mark unread → cyan; idle → none. Matches the sidebar card for the same session.
- [x] 6.3 Manual: select a session off-screen on the board (via sidebar/deep-link) → board scrolls it into view; clicking a visible row does not jump scroll.
- [x] 6.4 Light-mode pass: confirm stripe contrast on board card bg (`--bg-tertiary`); file a CSS-token follow-up if AA fails.
- [x] 6.5 Update `docs/file-index-client.md` rows for `OpenSpecBoardView.tsx`, `SessionCard.tsx`, `session-status-visuals.ts` (delegate to subagent, caveman style) noting the helper relocation + board stripes/auto-scroll. See change: port-session-card-state-visuals-to-openspec-board.
