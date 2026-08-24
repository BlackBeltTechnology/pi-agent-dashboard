# Tasks

> TDD throughout: write/adjust the test first, watch it fail, then the minimal change to pass.
> Everything here is client + config in `packages/grammar-plugin/` (+ one `packages/shared`
> type). No new endpoint, no wire-type change. Rebuild path: client → `npm run build` +
> restart; server/shared → restart (see the `implement` skill).

## 1. Preconditions (read before writing)

- [x] 1.1 Re-read the approved mock `openspec/changes/add-grammar-compact-view/mockups/final.html`
  (the exact modes, order, colours, persistence behaviour to match).
- [x] 1.2 Read `packages/grammar-plugin/src/useGrammarCheck.ts` (`accept`/`applyAll`/`dismiss`,
  offset-first/`indexOf` apply, staleness) and `GrammarPanel.tsx` (current list), `GrammarComposerPanel.tsx`,
  `grammar-diff.ts` — the seams reused/redesigned.
- [x] 1.3 Read `grammar-config.ts` (`GrammarConfig`, `DEFAULT_GRAMMAR`, `parseGrammarConfig`),
  `configSchema.json`, and `packages/shared/src/grammar-types.ts` (`GrammarHealth`) — where
  `correctionView` is added.
- [x] 1.4 Run `npm test 2>&1 | tee /tmp/gcv-baseline.log` — confirm a green baseline.

## 2. Config: `correctionView` (TDD)

- [x] 2.1 (TDD) In `__tests__/config-grammar.test.ts` + `config-grammar-edgecases.test.ts`:
  `parseGrammarConfig` defaults `correctionView` to `"redline"`; preserves `"list"`; clamps any
  other/absent/wrong-type value to `"redline"`; unknown keys still stripped. Watch red.
- [x] 2.2 Add `correctionView` to the `GrammarConfig` type + `DEFAULT_GRAMMAR` (`"redline"`) +
  `parseGrammarConfig` validation in `grammar-config.ts`, and to `configSchema.json`
  (`enum: ["redline","list"], default: "redline"`). Green 2.1.
- [x] 2.3 (TDD) `GrammarHealth` carries `correctionView`; the `GET /api/grammar/health` builder
  returns it from parsed config. Add/extend the route test in `__tests__/grammar-routes*.test.ts`
  (health includes `correctionView`, default `"redline"`). Implement to pass.

## 3. Redline segment builder (TDD — the subtle core)

- [x] 3.1 (TDD) Create `__tests__/grammar-redline.test.ts` FIRST. Cover:
  - single suggestion located by `offset`; located by `indexOf` fallback when offset drifted;
  - unlocatable (`original` absent) → dropped;
  - two adjacent changes; a multi-word `original` (`work good`) as one span; punctuation-fused
    (`work.`→`works.`);
  - overlapping spans → keep earliest, drop the overlap;
  - empty suggestions → one `unchanged` segment equal to the draft;
  - **round-trip invariants**: `Σ (unchanged + change.original) === draft`, and
    `Σ (unchanged + change.replacement) === all-applied text`.
  Watch red.
- [x] 3.2 Create `grammar-redline.ts` — `buildRedlineSegments(draft, suggestions)` +
  `Segment`/`DiffSegmentType`-style types. Implement to pass 3.1.
- [x] 3.3 (doubt-driven-review) Stress-test 3.1 against hand-computed expectations for the
  adjacent / overlapping / multi-word / fused-punctuation cases before the renderers trust it;
  document any divergence in the module header.

## 4. `GrammarRedlinePanel` component (TDD)

- [x] 4.1 (TDD) Create `__tests__/GrammarRedlinePanel.test.tsx` FIRST:
  - **redline mode** (default): renders each change as `original` (dotted, kind class) + green
    ghost `replacement`; unchanged words neutral; activating one change calls `onDraftChange`
    with only that span replaced (offset-safe); stale span is absent from the render.
  - **compact mode**: renders squiggle; focusing/hovering a change exposes **Apply** and
    **Ignore**; Apply → single-span `onDraftChange`; Ignore → removed, draft unchanged.
  - **original / corrected modes**: read-only plain before/after (changed spans tinted); click
    does nothing.
  - **Apply all** → `onDraftChange(correctedText)` then panel clears.
  - **mode persistence**: selecting a mode writes `localStorage["grammar.correctionMode"]`;
    remount reads it; an invalid stored value renders `redline`.
  - **kind→colour**: each change carries its kind's colour class.
  - **a11y**: each change is focusable with an aria-label naming kind/original/replacement/message;
    Enter applies in redline mode.
  Watch red.
- [x] 4.2 Create `GrammarRedlinePanel.tsx` — segmented toggle (`Redline · Compact · Original ·
  Corrected`, in that order), summary, footer, Apply-all, close; drives the four renderers off
  `buildRedlineSegments`; reuses `accept`/`applyAll`/`dismiss` from the hook; owns the
  `localStorage` mode state (default `redline`, invalid → `redline`). Green 4.1.

## 5. List view redesign → L2 columns (TDD)

- [x] 5.1 (TDD) Update `__tests__/GrammarPanel.test.tsx`: list rows render aligned
  `original → replacement` columns + a `kind` pill + the `message`; per-row Accept applies one
  (offset-safe), Dismiss removes without editing; Apply-all unchanged; stale row disables Accept.
  Watch red on the new layout assertions.
- [x] 5.2 Restyle `GrammarPanel.tsx` to the before→after column layout + kind pill + message,
  keeping the existing Accept/Dismiss/Apply-all wiring. Green 5.1.

## 6. Wire the view switch (TDD)

- [x] 6.1 (TDD) In `__tests__/useGrammarCheck.test.tsx`: `correctionView` from health is
  surfaced (default `"redline"` when absent). Implement in `useGrammarCheck.ts`.
- [x] 6.2 (TDD) In a `GrammarComposerPanel` test: renders `GrammarRedlinePanel` when
  `correctionView === "redline"`, `GrammarPanel` when `"list"`. Implement the branch in
  `GrammarComposerPanel.tsx`.

## 7. Settings control (TDD)

- [x] 7.1 (TDD) In `__tests__/GrammarSettings.test.tsx`: a **Correction view** segmented control
  renders; loads `data.plugins.grammar.correctionView` (default `redline` when absent); Save
  posts `correctionView` via `POST /api/config/plugins/grammar`. Watch red.
- [x] 7.2 Add the control to `GrammarSettings.tsx` (imports `GrammarConfig`); wire load/save. Green.

## 8. i18n

- [x] 8.1 Add strings to `src/i18n.ts` (+ inline English fallbacks): mode labels
  (`Redline`/`Compact`/`Original`/`Corrected`), `Apply`/`Ignore`, the per-change aria-label
  template, and the settings **Correction view** label + `Redline`/`List` options; provide the
  `hu` translations. No hard-coded display strings.
- [x] 8.2 (TDD) Extend `manifest.test.ts` / a render test to assert the new labels resolve via
  the catalog (no raw English leaks) — or fold into 4.1/7.1.

## 9. Tests + quality gate

- [x] 9.1 Run `npm test 2>&1 | tee /tmp/gcv.log`; `grep -nE 'FAIL|✗|Error' /tmp/gcv.log` clean.
- [x] 9.2 Run `npm run quality:changed` and clear new findings.
- [x] 9.3 (review-code) Inline review of the full diff before commit.

## 10. Docs

- [x] 10.1 Update `packages/grammar-plugin/AGENTS.md`: new rows for `grammar-redline.ts`,
  `GrammarRedlinePanel.tsx`, `__tests__/grammar-redline.test.ts`,
  `__tests__/GrammarRedlinePanel.test.tsx`; amend the `GrammarPanel.tsx`, `GrammarComposerPanel.tsx`,
  `useGrammarCheck.ts`, `grammar-config.ts`, `configSchema.json`, `GrammarSettings.tsx` rows +
  the `package.json`/shared `grammar-types.ts` note for `correctionView`. `See change:
  add-grammar-compact-view`.

## 11. Verify + land

- [x] 11.1 `openspec validate add-grammar-compact-view --strict` passes.
- [x] 11.2 Manual QA — confirmed working live in the running dashboard by the user (redline default renders, modes switch, corrections apply): enable grammar,
  type a multi-error draft, confirm redline is the default; step through all four modes; confirm
  the mode is remembered after reload; flip **Correction view** to List in settings and confirm
  the columnar panel; verify dark + light.

## Open questions

- [x] O.1 RESOLVED: keep `redline` mode apply-or-leave; explicit per-change **Ignore** stays in
  `compact` + `list` only, with Apply-all / close as the bulk paths. (Accepted on archive.)
