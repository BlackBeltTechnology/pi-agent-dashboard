## 1. Reproduce

- [x] 1.1 Build a standalone mockup of the composer toolbar inside a narrow, `overflow-hidden` split-chat-pane at a wide viewport → confirm the stop button clips and `Steer | Queue` / `after turn` overflow (`mockups/composer-split-overflow.html`, BROKEN panel).
- [x] 1.2 Measure the toolbar's natural inline width (`＋` · model · thinking · `Steer|Queue` · terminal · `after turn` · action) → ~689px; this sets the minimum fold threshold.

## 2. Implement

- [x] 2.1 Mark the composer card (`composer-card`) as a container (`@container`) in `packages/client/src/components/CommandInput.tsx`.
- [x] 2.2 Swap the toolbar folding classes from viewport `md:` to container `@[44rem]:` for thinking / `Steer|Queue` / terminal, and for the `⋯` overflow control (`md:hidden` → `@[44rem]:hidden`).
- [x] 2.3 Gate the `after turn` label on container width (`sm:inline` → `@[30rem]:inline`).
- [x] 2.4 Confirm the fold threshold (44rem ≈ 704px) sits above the ~689px natural inline width so the inline layout never overflows and the action button is never clipped.

## 3. Verify

- [x] 3.1 Mockup shows: narrow (560px) folds to `⋯`, boundary (640px, the previously-broken band) folds to `⋯`, wide (900px) renders all controls inline — nothing clipped.
- [x] 3.2 `CommandInput` unit tests pass (104/104); DOM structure unchanged (class-only edit).
- [x] 3.3 Production build succeeds and emits `@container (min-width:44rem)` + `(min-width:30rem)` into the client CSS.
- [x] 3.4 Update the per-file record `CommandInput.tsx.AGENTS.md` (container-based folding, breakpoints, `See change:`).
- [x] 3.5 Add a Playwright E2E scenario in `tests/e2e/split-composer-overflow.spec.ts` that opens split view (viewport 1280 ≥ md, chat pane < 44rem), asserts the composer `send-button` stays fully within the split-chat-pane bounds (no horizontal clipping) and the toolbar folds to `⋯`. Passes against the local-source Docker harness (`PW_E2E_USE_RUNNING`, system Chrome).
