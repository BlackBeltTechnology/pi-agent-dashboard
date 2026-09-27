## Context

See proposal.md — Why. The current state, client-only:

- `OpenSpecStepper.tsx` exports `deriveStepperState` (7 `NodeId`s, states `done|current|todo|disabled`) and the `OpenSpecStepper` renderer (`sidebar` | `compact`).
- The three consumers are:
  - `SessionOpenSpecActions.tsx` (sidebar variant plus the action row);
  - `OpenSpecBoardView.tsx` `ProposalCard` (compact variant, plus a separate progress block and a `BoardStatePill`);
  - `ComposerSessionActions.tsx`, which uses only `deriveStepperState` for its P/D/S/T `ArtifactChip`s.
- `deriveStepperState` today maps artifact `skipped` → `done`. Explore/Archive use `disabled` when attached / unattached.
- Visual reference: `mockups/openspec-compact-states/index.html`.

## Goals / Non-Goals

**Goals:**
- One lifecycle model (5 segments) shared by the session card, the board and the composer chips.
- One primary action per `ChangeState` on the session card. Everything else goes in `⋯`.
- ≥24 px segment hit targets. State is never conveyed by color alone.

**Non-Goals:**
- Changing `deriveChangeState`, the skill prompts sent, or any server/protocol.
- The unattached session branch (the attach combo, `+ Change` / `Propose` / `Explore`). It stays unchanged.
- The folder-level `FolderOpenSpecSection`.
- `ArtifactLettersButton` in the chat-view session header stays unchanged. The PDST spec requirement is only re-scoped to where the button actually renders.
- The board `DragChip` ghost, which keeps its state pill. It is a transient preview with no bar.

## Decisions

### D1 — Reshape `deriveStepperState` rather than add a parallel function
New types:
```ts
type SegmentId = "proposal" | "design" | "specs" | "tasks" | "archive";
type SegmentState = "done" | "current" | "todo" | "skipped";
interface DeriveStepperInput {
  artifacts: OpenSpecArtifact[];
  completedTasks: number;
  totalTasks: number;
  changeState: ChangeState | null;
}
```
- `attached` and `hasAnyChanges` are dropped. They only drove Explore/Archive `disabled`, which no longer exists.
- Tasks is `current` for READY ∨ IMPLEMENTING, which absorbs old Apply. It is `done` only at COMPLETE and `todo` in PLANNING.
- Ticked-count is *not* used for Tasks state. An IMPLEMENTING change with every box ticked (CLI `isComplete` still false) must still show an active step, otherwise the bar has zero `current` segments. The fill already shows 100 %.
- PLANNING may yield several `current` segments (every `ready` artifact). This is a real "authorable now" signal, not the old Tasks+Apply double-current bug.
- Archive is `current` iff COMPLETE, regardless of attachment. This fixes the board, which passed `attached=null` and so always showed Archive `disabled`.
- *Alternative:* keep the 7-node function and map it in the renderer. Rejected, because the composer chips would drift from the bar and the "two current nodes" bug would survive in the data layer.

### D2 — `skipped` becomes its own state
- It was collapsed into `done`. It is now distinct so the bar can hatch it.
- Consumers that only care about satisfied-vs-not treat `skipped` like `done`. The composer chip renders `skipped` as done, keeping current look.

### D3 — Segment = `<button>` containing track + label; container query for letters
- The label row is the hit area, which gives 24 px total height without inflating the track.
- The root is `role="group"` with `aria-label="OpenSpec lifecycle"`. It is not `role="list"`, because the segments are buttons, not list items.
- Colors come from `statusPresentation(kind)` in `client-utils` (`done` → `--status-idle`, `current` → `--status-working`, `todo` → `--text-muted`): `done`/`current`/`todo` map directly, and `skipped` uses `done`'s `tokenVar` with a `–` glyph plus a hatched track. This keeps the `client-utils-status-presentation` contract without adding a `StatusKind`.
- `container-type: inline-size` goes on the bar. `@container (max-width: 250px)` swaps the `.full` and `.short` label spans.
- Chosen over a JS `ResizeObserver` because there is zero runtime cost and no re-render on resize.
- The 250 px threshold keeps the session card (bar ≈ 280 px) on full labels. Board cards (bar ≈ 240 px) get letters.
- Segments that can't act (Archive when not COMPLETE, Tasks with 0 tasks, Archive on the board) render as `<div>`, not a disabled button. This keeps them out of the tab order.

### D4 — `⋯` overflow uses the existing menu primitive
- Render with the `client-utils` `Popover` primitive (`ui:popover`). `anchorEl` is kept in state and set from `event.currentTarget` on click, because Popover requires a non-null element. It anchors to the `⋯` button, flips and shifts on overflow, dismisses on Escape or outside click, and portals to the body.
- The body portal matters: `SessionCard` sets `isolate`, which would otherwise clip the menu (see `LayerPortal` notes).
- Menu order: FF | Verify (when not primary), Archive anyway…, **Explore…**, divider, Detach.
  - Every item handler calls `e.stopPropagation()`. React synthetic events bubble out of the body portal through the React tree to `SessionCard`'s root `onClick={onSelect}`; without the stop, menu clicks would select the card.
  - Items keep the MDI icons of today's buttons, per `mdi-icon-system`.
  - Explore… reuses the existing `ExploreDialog` with `changeName=<attached>`, sending `/skill:openspec-explore <name>\n<text>`.
  - This revives the change-scoped explore that the hard-disabled button blocked.
- Popover's root is already `role="dialog"`, so items are a plain vertical list of `<button>`s. This deliberately avoids `role="menu"`, which would promise arrow-key roving that the Popover doesn't provide.
- The `⋯` button carries `aria-haspopup="dialog"` and `aria-expanded`.
- On open, focus the first enabled item. On close (Escape or outside click), return focus to `⋯`.
  - Popover provides no focus management, so this is a small effect in the consumer that refocuses the anchor in `onDismiss`.
  - Popover renders `visibility:hidden` until its layout effect measures, and a hidden element can't take focus. So the first-item focus runs in a `requestAnimationFrame` scheduled from the consumer's mount effect, after the measured re-render, and is cancelled on unmount.
  - No `client-utils` change and no new dependency.
- Primary test IDs keep their current names: `continue-btn`, `ff-btn` (when FF is primary), `apply-btn`, `archive-btn` (now only as the COMPLETE primary), `verify-btn` (when Verify is primary). The same IDs sit on the menu items when those actions live in `⋯`. New IDs: `explore-menu-item`, `openspec-overflow-btn`.
- The streaming state disables items except Detach, and the primary button uses `aria-disabled`, not `disabled`. This keeps the tooltip reachable by keyboard.
- **Test ID changes:**
  - `openspec-overflow-btn` is new;
  - `ff-btn`, `verify-btn` and `archive-anyway-btn` move onto menu items, keeping their IDs;
  - `detach-btn` moves into the menu;
  - `explore-btn` (attached) and `state-pill` are removed.

### D4b — Workflow gating preserved
- Every attached action still goes through `wf(name)` (`cfg.workflows`).
- The primary is picked from an ordered candidate list per state: PLANNING `[continue, ff]`, READY/IMPLEMENTING `[apply]`, COMPLETE `[archive, verify]`. The first enabled one wins, and none means no primary.
- The `⋯` menu lists the remaining enabled candidates, plus Archive anyway (gated by `archive`), plus Detach (never gated).
- Under the `core` profile (`propose, explore, apply, archive`) PLANNING has no primary. Correct: the user disabled continue and ff.

### D4d — Tasks locked while streaming
- `TasksPopover` toggles checkboxes (`POST /api/openspec/tasks/toggle`), which races an agent rewriting `tasks.md`.
- The session card passes `onOpenTasks` to the bar only when `totalTasks > 0` and the session is not streaming, matching the composer's existing `disabled={streaming}` on the tasks chip.
- P/D/S previews stay clickable.

### D4c — Ended sessions keep Detach
- Today Detach sits outside the `!isEnded` gate.
- In the new layout, an ended session hides the primary but keeps `⋯` with Detach as its only item.
- The not-found branch (attached change missing from data) uses the same `⋯`-with-only-Detach pattern, so no standalone Detach button remains anywhere.

### D5 — Test ID rename
- `stepper-node-<id>` → `stepper-segment-<id>`, per user decision.
- `data-state` stays on each segment. `data-testid="openspec-stepper"` stays on the bar root.

### D6 — Archive segment click reuses the primary's confirm
- `deriveStepperState` with `changeState === null` returns every segment `todo`. This is defensive only: all consumers render the bar and chips only when a change is present.
- The bar stays ignorant of session status. The session card passes `onArchive` **only when** state is COMPLETE, the session is neither streaming nor ended, and `wf("archive")` is true. Otherwise it passes `undefined`.
- The bar makes the Archive segment interactive iff `onArchive` is defined.
- The board passes no `onArchive`, so the segment stays inert there.

### D7 — Board card
- Remove `BoardStatePill` from `ProposalCard` and remove the `board-card-progress` block.
- Keep `onPointerDown` stopPropagation on the bar wrapper so segment presses don't start a dnd-kit drag.
- Board columns are user-defined **groups**, not states. The bar's current segment is therefore the only state cue on the card. This is accepted; see Risks.

### D8 — Board per-session panel mount
- `BoardSessionRow` renders `SessionOpenSpecActions` inside an absolutely positioned `session-os-menu-panel`.
  - The panel's `menuOpen` toggles only via its own button and has no outside-click dismiss, so the panel is unaffected by the nested Popover.
  - The panel stops click propagation, and React events from the body-portalled Popover bubble through it. Menu clicks therefore neither navigate nor reach the dnd-kit card.
- The test asserts behavior: Detach from the nested `⋯` fires `onDetachProposal` for that session, with no navigation and no drag. It does not assert the panel's open state.

### D9 — Attached Explore rewired, not deleted
- The attached-branch `exploreOpen` state and its `ExploreDialog` mount are kept. Their trigger moves from the always-disabled button to the `⋯` **Explore…** item (see D4).

## Risks / Trade-offs

- [Inherited scenario and requirement names now read stale: `…with unchanged gating` (chat-view), heading `Lifecycle stepper on cards`, and the capability Purpose lines in `openspec-board` / `openspec-attach-combo`] → Accepted. The validator requires MODIFIED requirements to keep scenario names, and Purpose lines are not delta-managed. The normative THEN clauses are correct. Rename in a follow-up spec-hygiene pass.
- [`mobile-resilience` says the mobile kebab "matches the desktop sidebar card"] → Still true at the command-set level (Read/Explore/Continue/FF/Apply/Verify/Archive per state). Layout differs by design. No delta.

- [Board loses its explicit state word] → The bar's current segment plus its glyph shows the phase. The drag ghost keeps the pill. If users miss the word, re-add a pill behind a follow-up without touching the model.
- [Verify is less discoverable once it is in `⋯`] → This was accepted by the user. The Archive primary on COMPLETE nudges toward the end state. Verify stays one click deeper.
- [E2E selectors break (`stepper-node-*`, `explore-btn`, `detach-btn`)] → Rename in the same change. Grep `tests/e2e/` and `packages/**/__tests__` for each ID before landing.
- [Container-query label collapse can't be asserted in jsdom] → Assert it at the rendered-UI level; see test-plan.
- [PLANNING can pulse two segments] → Accepted. It reflects two authorable artifacts.
- [Container queries on old Electron/Chromium] → The project already uses container queries in the composer toolbar (chat-view spec), so no new baseline.

## Migration Plan

- Client-only change. Deploy with `npm run build` plus `/api/restart`.
- No persisted data or protocol change.
- Rollback = revert the commit and rebuild the client.
