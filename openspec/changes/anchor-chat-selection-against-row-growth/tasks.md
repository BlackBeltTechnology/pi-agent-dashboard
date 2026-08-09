## 1. Reproduce the geometry in a standalone mockup (D8)

- [x] 1.1 Create `mockups/chat-selection-anchor/index.html` — self-contained page: a scroll container with `overflow-anchor: none`, N absolutely-positioned rows at `translateY(start)` over a total-size spacer, a "grow row K by X px" button, and a `Fixes: ON/OFF` toggle. Model on `openspec/changes/fix-openspec-board-drop-targeting/mockup/index.html` (`id="fixToggle"`).
- [x] 1.2 With `Fixes: OFF`, reproduce the reported defect: begin a drag inside one row, grow a row **above** it, observe `getSelection().toString()` extend **backwards**. Record the measured shift — this is the evidence the fix is aimed at.
- [x] 1.3 With `Fixes: ON`, implement the D1/D2 correction inline in the mockup and confirm the selection tracks pointer travel only. Verify the shrink case and the user-scroll case (wheel during selection must NOT be fought).
- [x] 1.4 Exercise keyboard selection (Shift+Arrow) in both toggle states. **Resolves the design's keyboard open question** — record whether compensation is needed, redundant, or harmful, and write the finding into `design.md`.
- [x] 1.5 Confirm the historical reason for `overflowAnchor: "none"` at `ChatView.tsx:780` (git blame / originating change) and record it in `design.md` D1, so the "just delete that line" review question has a written answer.

## 2. Pure anchor arithmetic (D5)

- [x] 2.1 Write `packages/client/src/lib/__tests__/selection-anchor.test.ts` FIRST, encoding the D2 decision table plus whatever 1.2/1.3 measured: user-scroll-only → `0`; row-above-grows → full delta; TanStack-already-corrected (both deltas cancel) → `0`; drag-autoscroll → `0`; row-above-shrinks → negative delta; sub-epsilon jitter → `0`. Run and confirm red.
- [x] 2.2 Create `packages/client/src/lib/chat/selection-anchor.ts` exporting pure `computeAnchorCorrection({ prevTop, nextTop, prevScrollTop, nextScrollTop, epsilon })`. **Shipped contract (amended — the summed formula originally written here is unsatisfiable, see D2):** magnitude is `nextTop − prevTop`; the scroll pair is only the VETO discriminator, `magnitude + (nextScrollTop − prevScrollTop) ≈ 0` ⇒ pure viewport move ⇒ `0`. Also `0` on a sub-epsilon magnitude or any non-finite input. Stateless; no DOM access in this module.
- [x] 2.3 Re-run 2.1 — green. Confirm zero imports from `react` or `../components/`.

## 3. Single-clock selection signal (D6)

- [x] 3.1 Extend `packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx` with a failing case: on a `selectionchange` that starts a selection, the returned `isSelectingRef.current` is `true` **synchronously**, before any microtask flush or re-render (while the debounced `isSelecting` state must stay debounced).
- [x] 3.2 In `useActiveChatSelection.ts`, set a new `isSelectingRef` synchronously inside the `selectionchange` listener next to the existing `selectionSpanRef` write; return it. Do NOT change the `queueMicrotask` debounce on the state.
- [x] 3.3 In `ChatView.tsx`, delete the render-time mirror `isSelectingRef.current = isSelecting` and feed the `virtualizer.onChange` bottom-pin gate from the hook's synchronous ref. ~~Leave the D2 sticky-bottom `useLayoutEffect` reading the `isSelecting` **state** unchanged.~~ **SUPERSEDED (PR #439 review):** leaving it state-only left a reproducible first-frame hole — that effect now early-returns on `isSelecting || isSelectingRef.current`. The **state** remains in the dep array, which is what the →false edge and `wasSelectingRef` actually needed; the ref only widens the suspend.
- [x] 3.4 Re-run the hook tests plus the existing `chat-scroll-lock` and selection-preservation suites — green, no regressions.

## 4. Anchor capture (D4)

- [x] 4.1 Add a test asserting the anchor row element is captured on the collapsed→non-collapsed transition and is NOT re-captured on subsequent `selectionchange` events while the selection stays active (the anchor must not follow the pointer).
- [x] 4.2 Capture via `anchorNode.parentElement.closest("[data-index]")` and store the **`Element`**, never its `data-index` — an insertion above renumbers indices. Clear on collapse.
- [x] 4.3 Add a test asserting compensation stops when the stored anchor reports `isConnected === false`, rather than correcting against a stale rect.

## 5. Compensator wiring (D1/D3)

- [x] 5.1 Add a driven-geometry test (stub `getBoundingClientRect` and `scrollTop`, since jsdom has no layout) asserting: a simulated row-above growth while selecting produces exactly one `scrollTop` write of the residual; the same growth with no active selection produces none.
- [x] 5.2 In `ChatView.tsx`, add a `useLayoutEffect` with NO dependency array that early-returns unless a selection is active and an anchor element is stored. Read `anchorEl.getBoundingClientRect().top` and `scrollRef.current.scrollTop`, call `computeAnchorCorrection`, apply `scrollTop += correction` when non-zero.
- [x] 5.3 Re-baseline `prevTop`/`prevScrollTop` **immediately after** the write, inside the same effect, so the next commit does not observe our own correction as new drift. **Amended:** `prevTop` is DERIVED as `nextTop − applied` (with `applied` read back from `scrollTop` so a CLAMPED write stays exact), never re-measured — a second `getBoundingClientRect()` would cost a second forced reflow per commit, which task 7.1 forbids.
- [x] 5.4 Confirm placement is downstream of TanStack: an above-viewport resize must yield a ~0 residual and write nothing (D1). Assert explicitly rather than relying on ordering by accident.
- [x] 5.5 Verify no manual `scrollTop += delta` exists outside the active-selection guard — `fix-chat-scroll-to-top-estimate-drift` decision (2) must still hold on every non-selecting path.
- [x] 5.6 Diff the shipped implementation against the mockup's `Fixes: ON` branch; any divergence is either a bug or a deliberate adaptation that belongs in `design.md`.

## 6. Integration verification (Playwright)

> **BLOCKED (pre-existing, not caused by this change).** The specs are authored in
> `tests/e2e/selection-anchor.spec.ts` but could not be verified: the faux
> round-trip through the dashboard's browser path renders no transcript content,
> so every spec times out on its marker.
>
> Evidence it is not this change: `pi --print "[[faux:poll-narrated]] go"` inside
> the container works; the client renders with no page errors; and the UNTOUCHED
> control spec `tool-collapse-narration.spec.ts` fails identically on a **pristine
> tree** (`git stash -u` + full `docker compose build`). Host load was ruled out
> (retried at load 3.0 vs 19 — same result).
>
> It rotted invisibly because the browser E2E suite is **not in CI** —
> `.github/workflows/` runs only `test:e2e:electron`. Worth its own proposal.
>
> **To unblock:** repair the faux round-trip, then `docker compose -f
> docker/compose.yml build` → `PI_E2E_SEED=1 PI_TEST_PEERS=both
> ./docker/test-up.sh -d` → `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1
> PW_E2E_PORT=$(jq -r .dashboardPort .pi-test-harness.json) npx playwright test
> selection-anchor` → `./docker/test-down.sh`. **Sanity gate:** confirm
> `tool-collapse-narration` passes FIRST — if the control still fails, a
> `selection-anchor` failure means nothing.
>
> **First-frame residual: CLOSED (was deferred, then fixed in review).** The
> sticky-bottom `useLayoutEffect` originally read only the debounced
> `isSelecting` STATE, per task 3.3's instruction, leaving a window where a chunk
> could still reach `el.scrollTop = el.scrollHeight`. CodeRabbit flagged it as a
> Major on PR #439 and it turned out to be REPRODUCIBLE in jsdom after all — but
> only with the SYNC `act` overload, because the async one drains the microtask
> queue and closes the very window under test (the first attempt passed
> vacuously). Red message: `expected 5000 not to be 5000`. Fixed by gating that
> effect on `isSelecting || isSelectingRef.current`; the STATE stays in the dep
> array so the → false edge still re-fires the pin. Task 3.3's "leave it
> unchanged" instruction is superseded. Regression test: "suspends the bottom-pin
> before the debounced isSelecting state catches up".

- [ ] 6.1 Add the acceptance scenario for the original report: seed a transcript with a running tool card above a prose message, drag inside that one message, complete the tool card mid-drag so its output body renders, assert `getSelection().toString()` never extends above the drag origin.
- [ ] 6.2 Shrink counterpart: a row above the anchor collapses mid-drag; assert the selection does not extend below the drag origin.
- [ ] 6.3 Above-viewport scenario: scroll a row entirely above the viewport, resize it while selecting, assert the anchor moves by the delta exactly **once** (double-move guard).
- [ ] 6.4 No-selection control: same growth with no selection; assert scroll behaviour matches today including sticky-bottom follow.
- [ ] 6.5 First-frame scenario (D6): begin a drag and deliver a streaming chunk before React commits; assert no scroll-to-bottom occurred.
- [ ] 6.6 User-scroll scenario (D2): wheel-scroll during an active selection; assert the compensator does not fight it.
- [ ] 6.7 Run against the docker harness per `run-dashboard-e2e-local-changes` so it exercises local code, not a cached image.

## 7. Performance and quality gates

- [x] 7.1 Profile a streaming turn with a held selection; confirm one `getBoundingClientRect` + at most one `scrollTop` write per commit, and no second forced reflow.
- [x] 7.2 Confirm the `chat-idle-render-cost` budget is unregressed — the compensator must be fully inert with no selection active.
- [x] 7.3 Add a regression assertion that the scroll container carries neither `scroll-behavior: smooth` nor a smooth-scroll call on the compensation path.
- [x] 7.4 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`. **Outcome (not "green"):** 12 545 passed / 13 failed, and each of the 13 was confirmed PRE-EXISTING by re-running it with this work `git stash`-ed. Those failures were separately root-caused and fixed in PR #441 (zombie-resume test-mock drift), after which CI on this branch is green. Log: `/tmp/pi-test.log`.
- [x] 7.5 `npm run quality:changed` — Biome clean on changed files.
- [ ] 7.6 Rebuild per the client path of the rebuild matrix: `npm run build && curl -X POST http://localhost:8000/api/restart`, then reproduce the original report manually and confirm it is fixed.

## 8. Documentation

- [x] 8.1 Add a row for `selection-anchor.ts` to `packages/client/src/lib/chat/AGENTS.md` (purpose, exported pure fn, `See change: anchor-chat-selection-against-row-growth`), path-alphabetical.
- [x] 8.2 Update the `ChatView.tsx.AGENTS.md` and `useActiveChatSelection.ts` rows with the compensator and the synchronous-ref change, including the D1 residual-measurement rationale so the next person does not "simplify" it into a classifier.
- [x] 8.3 Add a row for `mockups/chat-selection-anchor/` in the nearest directory `AGENTS.md`.
- [x] 8.4 Fold the 1.4 and 1.5 findings into `design.md`, closing the open questions with evidence rather than deleting them.
- [x] 8.5 Run the `review-code` discipline skill on the diff before commit.
- [x] 8.6 `openspec validate anchor-chat-selection-against-row-growth --strict`.
