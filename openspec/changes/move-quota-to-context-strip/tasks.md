## 1. Shared slot contract

- [x] 1.1 Add `"composer-context-group"` to `SlotId` union + `SLOT_DEFINITIONS` (`multiplicity: "many"`, `payloadTier: "react-only"`) in `packages/shared/src/dashboard-plugin/slot-types.ts`; add context props `{ session, pluginContext }` in `slot-props.ts`; add the id to `SessionScopedSlot`. No new claim fields. Verify `npx tsc -p packages/shared --noEmit` passes.
- [x] 1.2 Test (test-plan E16): extend the existing slot-taxonomy test in `packages/shared/src/dashboard-plugin/__tests__/` (see sibling slot-types test) — input `SLOT_DEFINITIONS["composer-context-group"]` · trigger existing enumeration · observable `multiplicity === "many"`, `payloadTier === "react-only"`, `SlotPredicateInput<"composer-context-group">` compiles as `DashboardSession`. Verify it fails before 1.1 and passes after.
- [x] 1.3 Add a `CHANGELOG.md` `[Unreleased]` entry for the new slot + `ComposerContextGroup` export (versions bump at `release-cut`). Verify the entry is present.

## 2. Runtime consumer + primitive (tests first, then implement)

All tests in `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx`; copy harness glue from its existing `ContentInlineFooterSlot` cases.

- [x] 2.1 Test (test-plan E12): two `composer-context-group` claims, plugin `b` priority 10 and plugin `a` priority 20 · render `ComposerContextGroupSlot` · DOM order `a` before `b`. Verify red.
- [x] 2.2 Test (test-plan E13): one claim whose component returns `null` · render slot · container has zero child elements. Verify red.
- [x] 2.3 Test (test-plan E14): claim with `shouldRender` predicate false for `session.id === "s1"` · render with `s1` then `s2` · node absent for `s1`, present for `s2` (mirror the footer-slot case). Verify red.
- [x] 2.4 Test (test-plan E15): `<ComposerContextGroup label="Quota" testId="g">child</ComposerContextGroup>` · render · root `[data-testid=g]` has `inline-flex` + `shrink-0`; contains `aria-hidden` divider, then `[data-testid=g-label]` text `Quota` with `uppercase`, then `child`. Verify red.
- [x] 2.5 Implement `ComposerContextGroupSlot` in `slot-consumers.tsx` mirroring `ContentInlineFooterSlot` (claims + intents, `{ session }` props) and `ComposerContextGroup` with the classes from design D3; export both from the runtime index. Verify 2.1–2.4 green.

## 3. Context strip mount (tests first, then implement)

All tests in `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx`; copy the worktree-session + slot-registry setup from its existing cases.

- [x] 3.1 Test (test-plan F1): worktree session + fake `composer-context-group` claim rendering `<ComposerContextGroup label="Quota" testId="quota-context-group">` + a `session-card-badge` claim · render · `composer-git-group` precedes `quota-context-group` precedes the STATUS label (`compareDocumentPosition`). Verify red.
- [x] 3.2 Test (test-plan F2): same setup, `status = "streaming"`, fake group contains a `<button>` · render · fake button `disabled === false`; `Explore`/`Archive` disabled; refresh enabled. Verify red.
- [x] 3.3 Test (test-plan F3): session with no `gitWorktree`, `openspecHasDir=false`, `openspecPending=false`, no badge claim, one context-group claim · render · strip is not `null` and contains the fake group; with the claim removed → `null`. Verify red.
- [x] 3.4 Test (test-plan F5): no context-group claim · render · strip child count equals the pre-change count (snapshot the count before editing). Verify it passes before and after 3.6.
- [x] 3.5 Test (test-plan F4): run the existing `ComposerSessionActions.test.tsx` suite unchanged · all existing `composer-git-group*` / OpenSpec assertions pass after 3.6 (regression guard; no new code).
- [x] 3.6 Mount `ComposerContextGroupSlot` between GIT and STATUS, outside the streaming `<fieldset disabled>`, passing `session`; add `useSlotHasClaimsForSession("composer-context-group", safeSession)` to the early-return guard. Host groups untouched. Verify 3.1–3.5 green.

## 4. Quota plugin widget (tests first, then implement)

Helper tests next to the widget; widget tests in `packages/quota-plugin/src/__tests__/widget.test.tsx` (copy its existing `useQuota` mock + render glue). Testids per design D5.

- [x] 4.1 Test (test-plan E9): `providerForModel` with `"anthropic/x"`, `"openai-codex/x"`, `undefined`, `"my-alias"`, `"a/b/c"` · call · `anthropic`, `openai-codex`, `undefined`, `undefined`, `a`. Verify red.
- [x] 4.2 Test (test-plan E1): `providers: []`, `session.model="anthropic/claude-x"` · render `QuotaWidget` · no `quota-context-group`, no `quota-no-adapter-note`, no console error. Verify red (current widget renders `quota-widget`… assert the new ids).
- [x] 4.3 Test (test-plan E2): `[{provider:"anthropic", windows: []}]` · render · container empty. Verify red.
- [x] 4.4 Test (test-plan E3): `anthropic` windows `5h 14%` + `7d 32%` · render · `quota-chip-anthropic` text contains `5h`, `14%`, `7d`, `32%`; exactly 2 bar elements. Verify red.
- [x] 4.5 Test (test-plan E4): `session.model="anthropic/claude-x"`, providers `[openai-codex, anthropic]` · render · first chip `quota-chip-anthropic` with `data-session-provider="true"`; `quota-chip-openai-codex` `data-dimmed="true"`; no note. Verify red.
- [x] 4.6 Test (test-plan E5): `session.model="google-vertex/gemini-x"`, providers `[anthropic]` · render · `quota-no-adapter-note` text `gemini-x · no quota`, not a `<button>`, precedes the chip; chip `data-dimmed="true"`, no `data-session-provider`. Verify red.
- [x] 4.7 Test (test-plan E6): `session.model` undefined, providers `[anthropic, openai-codex]` · render · no `data-session-provider`, no `data-dimmed`, no note. Verify red.
- [x] 4.8 Test (test-plan E7): `session.model="my-alias"`, providers `[anthropic]` · render · same observable as 4.7. Verify red.
- [x] 4.9 Test (test-plan E8): `session.model="google-vertex/publishers/google/models/gemini-x"`, providers `[anthropic]` · render · note text `publishers/google/models/gemini-x · no quota`. Verify red.
- [x] 4.10 Test (test-plan E10): `anthropic` with `stale: true` · render · chip `data-stale="true"`, contains the `not live` text, bar uses muted severity. Verify red.
- [x] 4.11 Test (test-plan E11): `session.model="anthropic/claude-sonnet-4"`, providers `[anthropic]` · render · chip text does not contain `claude-sonnet-4`. Verify red.
- [x] 4.12 Test (test-plan F6): render with `session.model="anthropic/x"`, providers `[anthropic, openai-codex]`; rerender with `session.model="openai-codex/y"` · rerender · first chip `quota-chip-openai-codex` ringed, `quota-chip-anthropic` dimmed, no click/timer. Verify red.
- [x] 4.13 Test (test-plan X1): `useQuota` fetch rejects (network error) · render · nothing rendered, no throw. Verify red or already-green (keep as guard).
- [x] 4.14 Test (test-plan X2): `/api/quota` → `{}` · render · nothing rendered, no throw. Verify red or already-green (keep as guard).
- [x] 4.15 Test (test-plan X4): extend the existing catalog key-parity test in `packages/quota-plugin/src/__tests__/` (see sibling i18n test; create alongside `dialog.test.tsx` if absent) · new keys `quota`, `noQuota`, chip aria key · present in `zh-CN` and `hu`. Verify red.
- [x] 4.16 Implement `providerForModel` in `packages/quota-plugin/src/client.tsx`; rewrite `QuotaWidget` per design D3/D5–D7 (wrapped in `<ComposerContextGroup label={t("quota")} testId="quota-context-group">`, `null` when no provider has windows, chip `<button>` with localized `aria-label`, `data-session-provider` / `data-dimmed` / `data-stale`, ring via `box-shadow` on `var(--accent, #3b82f6)`, dashed `stale` tag reusing the existing `stale` string, accessible note); add `zh-CN` + `hu` keys to `i18n.ts`. Verify 4.1–4.15 green and `dialog.test.tsx` still passes.
- [x] 4.17 Change `packages/quota-plugin/package.json` claim `content-inline-footer` → `composer-context-group`; rewrite the header comment in `client.tsx` (drop the "stays in footer" rationale). Verify `npm test -w packages/quota-plugin` passes.

## 5. Browser E2E (docker harness)

New spec `tests/e2e/quota-context-strip.spec.ts`; copy the `page.route` stub glue from `tests/e2e/blackhole-settings.spec.ts` and the `composer-context-strip` session-open glue from `tests/e2e/route-backed-overlay.spec.ts`. Read the harness port from `.pi-test-harness.json`.

- [x] 5.1 Test (test-plan F7): `page.route("**/api/quota")` → anthropic with windows `5h 14%` + `7d 32%` · open chat view · `quota-context-group` visible inside `composer-context-strip`, chip text has `14%` and `32%`, no `quota-chip-*` inside the inline-footer region. Verify green against the harness.
- [x] 5.2 Test (test-plan F8): same stub · click `quota-chip-anthropic` · `role=dialog[aria-modal]` visible with the Anthropic card; `Escape` closes it. Verify green.
- [x] 5.3 Test (test-plan F9): same stub, viewport `900×800`, worktree session so OPENSPEC + GIT + QUOTA render · open chat view · `quota-context-group-label` bounding-box `y` equals the first `quota-chip-*` `y`; group `x` ≥ 0. Verify green.
- [x] 5.4 Test (test-plan X3): `page.route("**/api/quota")` → `route.abort()` · open chat view · strip visible with GIT group, no `quota-context-group`, `pageerror` count 0. Verify green.

## 6. Integration, docs, review

- [ ] 6.1 `npm run build && curl -X POST http://localhost:8000/api/restart`; open a session and confirm the `QUOTA` group renders after GIT and the footer no longer shows quota (screenshot at 1600px).
- [ ] 6.2 Manual (test-plan: manual-only F10): viewport 375px with 2 providers enabled — judge wrap legibility, note any horizontal clipping (accepted trade-off).
- [ ] 6.3 Manual (test-plan: manual-only F11): live session, switch model `anthropic → openai-codex` in the composer selector — ring moves without interaction.
- [ ] 6.4 Manual (test-plan: manual-only F12): quota group beside GIT — label size/colour/divider gutter indistinguishable.
- [ ] 6.5 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures; run `npm run quality:changed` and verify clean.
- [ ] 6.6 Update per-file `AGENTS.md` rows for `slot-types.ts`, `slot-props.ts`, `slot-consumers.tsx`, runtime index, `ComposerSessionActions.tsx`, `quota-plugin/src/client.tsx`, `quota-plugin/src/i18n.ts`, `quota-plugin/package.json`, `tests/e2e/quota-context-strip.spec.ts` (`See change: move-quota-to-context-strip`); delegate `docs/architecture.md` slot-list + `packages/quota-plugin/README.md` update to DocScribe. Verify `kb dox lint` reports no stale rows for the touched files.
- [ ] 6.7 Run `review-code` discipline on the full diff and `doubt-driven-review` on the slot name/payload before commit. Verify findings addressed or recorded.
