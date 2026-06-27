# Tasks — extend-client-utils-state-feedback-primitives

## 1. EmptyState primitive
- [x] 1.1 Add `packages/client-utils/src/EmptyState.tsx` with `{title, body?, icon?, action?, secondaryAction?}` enforcing one-primary-CTA → verify: unit test rejects >1 primary action; renders title/body/CTA.
- [x] 1.2 Refactor chat `"No messages yet"` (`ChatView.tsx`) + board `"No proposals"` (`OpenSpecBoardView.tsx:630`) onto `EmptyState` with value-framed copy + CTA → verify: snapshot shows pattern; copy review.

## 2. Skeleton primitive
- [x] 2.1 Add `packages/client-utils/src/Skeleton.tsx` (`variant=text|card|bubble|row`, `count?`) honoring `prefers-reduced-motion` (static shimmer) → verify: unit test asserts static under reduced-motion.
- [x] 2.2 Refactor chat-history load (`ChatView.tsx:625`) from spinner → `<Skeleton variant="bubble">` → verify: no layout shift (CLS) vs real bubbles; spinner removed for that path.

## 3. focus-ring utility
- [x] 3.1 Add `.focus-ring` to `packages/client/src/index.css` (`:focus-visible`, ≥2px, offset) + `focusRing` export from client-utils → verify: ≥3:1 contrast in all 4 themes (axe/contrast, Q1, hard gate).
- [x] 3.2 Refactor first targets (search boxes `SessionList.tsx:976/985`, composer textarea + Send `CommandInput.tsx:645/669`) onto `.focus-ring` → verify: keyboard-tab shows visible ring; mouse-click does not.

## 4. Status presentation
- [x] 4.1 Audit current `StatusPill` consumers (Q2) → verify: list of call sites + props captured.
- [x] 4.2 Extend `StatusPill`/status helper: semantic `--status-*` token + mandatory non-hue channel (icon/shape) → verify: unit test asserts a non-color indicator present per state.
- [x] 4.3 Refactor composer `ArtifactChip` (done gets ✓ glyph + `aria-label`) and board `STATE_COLORS` onto the helper → verify: done≠todo without color; SR announces artifact name + state.
- [x] 4.4 Coordinate token ownership with `improve-dashboard-attention-routing` (Q5) → verify: `--status-*` defined once; both changes reference, not redefine.

## 5. aria-label + target-size sweep (first targets)
- [x] 5.1 Add `aria-label` to icon-only `Send` (`CommandInput.tsx`), `Pi Resources` (`FolderActionBar.tsx`), `ArtifactChip` → verify: axe smoke passes; SR names correct.
- [x] 5.2 Bump primary tap targets (Send, spawn buttons) to ≥44px → verify: measured ≥44×44 at mobile width.

## 6. Adoption ratchet
- [x] 6.1 Add `packages/client/src/__tests__/state-feedback-adoption.test.tsx`: axe smoke over new primitives + static check failing NEW inline-empty / bare-`focus:outline-none` / color-only-status in covered surfaces (allowlist for legacy) → verify: red on a planted violation, green after fix.

## 7. Mockup loop + docs
- [x] 7.1 Mock EmptyState + Skeleton + status states (dark+light, 375/768/1440), `serve_mockup`, `score_mockup` rubric green → verify: passed/N in code, no open WCAG-AA/sev-4.
- [x] 7.2 Promote refactors in an isolated env (`isolated-ui-verification`); `lsof -i:8000` unchanged → verify: isolated port shows new behavior, live PID untouched.
- [x] 7.3 Doc "State & feedback primitives" section (when EmptyState vs Skeleton vs spinner, `.focus-ring`, status convention) + `docs/file-index-client.md` rows (delegate to subagent, caveman style) → verify: rows present, alphabetical.
- [x] 7.4 `npm test` + `npm run quality:changed` green → verify: single exit 0.
