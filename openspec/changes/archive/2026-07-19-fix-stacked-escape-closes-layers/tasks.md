# Tasks

## 1. Reproduction + baseline (systematic-debugging)

- [x] 1.1 Regression coverage delivered as the folded **F1** scenario (`escape-stack-integration.test.tsx` — real `Dialog` + `ImagePreviewStrip`→`ImageLightbox`; one Escape peels only the lightbox, dialog `onClose` NOT called; a second closes the dialog). Pre-fix both closed (double-close); post-fix passes.
- [x] 1.2 Overlay-on-overlay covered by the folded **F3** scenario (`FilePreviewOverlay` base + `ImageLightbox` stacked; first Escape closes only the lightbox, second closes the preview).

## 2. Shared escape-dismiss stack primitive

- [x] 2.1 Add `packages/client-utils/src/escape-stack.ts`: a module-level LIFO array of `{ id, onEscape }` entries and a **single module-stable** (one function reference, not recreated per push) `keydown` listener on **`document`, bubble phase**. On `Escape`: return early if `e.repeat` or `e.defaultPrevented`; else invoke `onEscape` of the **last** (topmost) entry only, then consume with `e.preventDefault()` + `e.stopImmediatePropagation()`. Do not walk the stack. **Attach once on the first registration and never detach** (early-return when the stack is empty) — detaching on empty would let another `document` listener slip ahead in registration order.
- [x] 2.2 Export `useEscapeDismiss(active: boolean, onEscape: () => void)`: derive a **`useId`-stable** id (survives StrictMode mount→unmount→mount); on `active` true push `{ id, onEscape }` with a **ref-backed** `onEscape` (latest callback without re-registering); on `active` false / unmount remove **by id** (order-independent splice), never `pop()`. Guard against duplicate registration for the same id across re-renders.
- [x] 2.3 Document the phase choice in the file header: `document`-bubble is chosen so a focused input's own Escape handler runs first and can opt out via `defaultPrevented`, while the consume still dominates `window`-level peers. Note the transitional boundary (unmigrated overlay on top of a migrated one can still double-dismiss until it too adopts the hook).
- [x] 2.4 Add `__resetEscapeStack()` for vitest module-cache isolation (empties the stack; used with `__detachForTest` if needed). **Dev/test-gated** (guard behind a dev/test check or a non-obvious name) so production code cannot wipe global dismissal.
- [x] 2.5 Document the React-synthetic interaction in the file header: a child that calls React `e.stopPropagation()` on Escape halts the native event at the React root, so the shared listener never runs — correct for an OPEN combobox/typeahead (opts out by design). Migration rule: a stack-eligible surface MUST NOT contain a child that *unconditionally* `stopPropagation`s Escape.

## 3. Adopt in the four stacking surfaces

- [x] 3.1 `packages/client-utils/src/Dialog.tsx`: replace the `window.addEventListener("keydown", …Escape→onClose)` effect with `useEscapeDismiss(open, onClose)`. Leave overlay-click dismissal and focus-trap untouched.
- [x] 3.2 `packages/client/src/components/preview/ImageLightbox.tsx`: remove the `Escape` branch from the `document` keydown effect and call `useEscapeDismiss(true, onClose)`; keep the backdrop-click `document` click listener.
- [x] 3.3 `packages/client/src/components/preview/FilePreviewOverlay.tsx`: same swap — `useEscapeDismiss(true, onClose)`; keep the backdrop-click listener and the composer-inset measurement effect. Verify `z-50` vs `Dialog` `z-60`: a preview opened from a dialog must render **above** it; if inverted, raise the overlay's z-index (align above `Dialog`).
- [x] 3.4 **Delete, don't co-locate:** in each migrated surface confirm the prior `document`/`window` `keydown` Escape effect is fully removed (keeping both the old listener and the hook would double-dismiss). Grep the three files for a residual `keydown` Escape handler after the swap.
- [x] 3.5 **MermaidBlock is NOT migrated in v1** (inline, not portaled). Leave `packages/client/src/components/preview/MermaidBlock.tsx` unchanged; capture its focused-mode double-close as a follow-up task in the change's notes.

## 4. Tests (folded from test-plan.md — 18 automated scenarios, all L1)

All rows route to `packages/*/**/__tests__/*.test.ts(x)` (vitest + jsdom). Stack-unit rows land in a new `packages/client-utils/src/__tests__/escape-stack.test.ts`; surface rows in the relevant component test.

### Stack unit — new `escape-stack.test.ts` (exemplar: `packages/client-utils/src/__tests__/Dialog.test.tsx` for the client-utils test harness/setup)

- [x] 4.1 E1 topmost-only: A then B registered (B top) · one `Escape` keydown · `B.onEscape` called once, `A.onEscape` not. (test-plan #E1)
- [x] 4.2 E2 successive peel: A,B,C registered · three `Escape` keydowns · dismiss order C,B,A, each once. (test-plan #E2)
- [x] 4.3 E3 lone layer: single layer A · one `Escape` · `A.onEscape` called once. (test-plan #E3)
- [x] 4.4 E4 order-independent unregister: A,B registered, A removed by id · one `Escape` · `B.onEscape` called, A not, no stale entry. (test-plan #E4)
- [x] 4.5 E5 empty passthrough: no layers + spy `window` keydown · one `Escape` · spy fires, no `preventDefault`/`onEscape`. (test-plan #E5)
- [x] 4.6 E6 consume blocks window: layer A + spy `window` keydown · one `Escape` · `A.onEscape` fires, window spy does NOT, `preventDefault`+`stopImmediatePropagation` called. (test-plan #E6)
- [x] 4.7 E7 key-repeat guard: A,B registered · `Escape{repeat:true}` then `{repeat:false}` · repeat dismisses nothing, non-repeat dismisses B only. (test-plan #E7)
- [x] 4.8 E8 defaultPrevented opt-out: layer A · `Escape` with `defaultPrevented` true · `A.onEscape` NOT called, A stays. (test-plan #E8)
- [x] 4.9 E9 StrictMode id stability: hook under StrictMode mount→unmount→mount · one `Escape` · one entry, fires once, no leak/drop. (test-plan #E9)
- [x] 4.10 E10 attach-once/never-detach: `addEventListener` spy, register→unregister-all→register · inspect · document keydown attaches once, count stays 1 across empty→refill, no duplicate. (test-plan #E10)
- [x] 4.11 E11 latest handler: A with `cb1`, re-render same id `cb2` · one `Escape` · `cb2` called not `cb1`, single entry. (test-plan #E11)

### Surface component tests (exemplars: `packages/client/src/components/__tests__/ImageLightbox.test.tsx`, `.../Dialogs.test.tsx`, `packages/client-utils/src/__tests__/Dialog.test.tsx`)

- [x] 4.12 F1 reported case: `Dialog` with `ImagePreviewStrip`, click thumbnail→lightbox · `Escape` then a second · first unmounts lightbox (dialog stays), second fires dialog `onClose`. (test-plan #F1)
- [x] 4.13 F2 markdown-dialog + lightbox: `Dialog` rendering `MarkdownContent` with `<img>`, click image→lightbox · one `Escape` · lightbox unmounts, dialog stays. (test-plan #F2)
- [x] 4.14 F3 overlay-on-overlay: `FilePreviewOverlay` (base) + `ImageLightbox` stacked · `Escape` then a second · first closes lightbox (preview stays), second closes preview. (test-plan #F3)
- [x] 4.15 F4 React-stopPropagation opt-out: `Dialog` with an OPEN combobox that React-`stopPropagation`s Escape · `Escape` then a second · first closes combobox (dialog stays), second closes dialog. (test-plan #F4)
- [x] 4.16 F5 z-order: `FilePreviewOverlay` rendered while a `Dialog` is open · inspect stacking · overlay z-index token ≥ dialog layer (`z-60`), not behind. (test-plan #F5)
- [x] 4.17 F6 textarea parity: Explore-style `Dialog`, focus in `<textarea>` (no opt-out) · one `Escape` · dialog `onClose` fires (unchanged from pre-fix). (test-plan #F6)

### Regression

- [x] 4.18 X1 delete-old-listener: a lone migrated `Dialog` (post-swap, no residual keydown effect) · one `Escape` · `onClose` called EXACTLY once, not twice. (test-plan #X1)

### Existing-test edits (not new scenarios — harness updates)

- [x] 4.19 Update `ImageLightbox.test.tsx` Escape dispatch/target for the `document`-bubble + consume change; add a single-layer Escape test to `FilePreviewOverlay.test.tsx`. Also fixed the `document`-listener move in `Dialog.test.tsx` + five other Dialog-consumer suites (Confirm, QrCodeDialog, WorktreeSpawnDialog, WhatsNewDialog, AgentToolRenderer) that dispatched Escape on `window`.
- [x] 4.20 Listener hygiene (**reconciled** — supersedes the duplicate `4.11` that contradicted E10/never-detach): the shared `keydown` listener attaches **once** and stays attached (never detached on empty), never duplicated across register→empty→register; covered by E10 (task 4.10). The stale spec scenario "No listener leak when the stack empties" was aligned to the decided never-detach design.

## 5. Documentation

- [x] 5.1 Update the directory `AGENTS.md` tree rows for `escape-stack.ts`, `Dialog.tsx`, `ImageLightbox.tsx`, `FilePreviewOverlay.tsx`, `MermaidBlock.tsx` per the Documentation Update Protocol (new primitive; each surface now dismisses via the shared stack).
- [x] 5.2 Add a one-line note in `docs/architecture.md` (or the relevant UI topic doc) that global Escape dismissal is arbitrated by the shared escape-stack — new dismissible overlays SHOULD use `useEscapeDismiss` rather than a self-managed global listener (delegate `docs/` prose per Rule 6).

## 6. Verify

- [x] 6.1 `npm test` green (new + existing dialog/lightbox/preview suites).
- [x] 6.2 The reported Explore-dialog + attached-image path is **automated** by F1 (real `Dialog`+`ImagePreviewStrip`→`ImageLightbox`, one Escape peels only the image). Visual belt-and-suspenders spot-check is optional (not a manifest row per test-plan).
- [x] 6.3 `review-code` pass on the diff; `doubt-driven-review` on the topmost-only + order-independent-pop invariants before commit.
