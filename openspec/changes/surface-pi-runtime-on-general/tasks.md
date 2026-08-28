## 1. Pi runtime status row (read-only)

- [x] 1.1 Write failing component tests for `PiRuntimeStatusRow` in `packages/client/src/components/settings/__tests__/` (exemplar: `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx` for rendering this component family) covering (test-plan E2, E3, E4): `consumerDiverged` + equal versions → `consumerMessage` verbatim as warning; `spawnVersion` or `moduleVersion` null → unknown-version fallback, no crash, no fabricated value; `piRuntime` absent or null → row renders nothing, no error
- [x] 1.2 Widen `packages/client/src/hooks/usePiCompatibility.ts` to expose `piRuntime` beside `compatibility` from the same `/api/health` fetch — a breaking return-shape change (`PiCompatibility | null` → object carrying both); then create `packages/client/src/components/settings/PiRuntimeStatusRow.tsx` receiving `piRuntime` as a prop; strictly read-only (no `POST /api/pi/runtime`, no `PUT`/`DELETE /api/tools/:name`, no `CONFIG_FIELD_PAGE` entry, no Save Bar contribution); no automatic-vs-pinned labels
- [x] 1.3 Give the row a `Change…` affordance wired through an injected navigate-with-scroll callback prop (test-plan E5: render row, activate every interactive element, assert zero requests to `POST /api/pi/runtime` / `PUT` / `DELETE /api/tools/:name`); keep the row render-gated only on data availability, never on the version advisory's visibility condition
- [x] 1.4 Add i18n keys for the row's copy and the shared `Change…` label to the zh and hu catalogues in `packages/client/src/lib/i18n/` per the `settings-unit-i18n` convention
- [x] 1.5 Extend `packages/server/src/__tests__/health-shape.test.ts` (exemplar: itself) (test-plan E7): the `piRuntime` key set on the unauthenticated `/api/health` response stays ⊆ {spawnVersion, moduleVersion, consumerDiverged, consumerMessage} — no filesystem path, no pinned/override indicator (design D2 gate)

## 2. Navigation with optional scroll target

- [x] 2.1 Extend `requestRailNavigate` in `packages/client/src/components/settings/SettingsPanel.tsx` with an optional section scroll target: navigate via the existing rail path (gating semantics unchanged — guards only on leaving a dirty plugin page), carry the target through the deferred-navigation round trip via a pending scroll-target ref alongside `pendingNav` (no `pendingNav` type change; `BACK_SENTINEL` comparisons untouched), and scroll the target section (`data-testid="pi-runtime-section"`) into view after the destination renders; no URL hash or extra query parameter
- [x] 2.2 Extend the SettingsPanel tests in `packages/client/src/components/settings/__tests__/` for the navigation guard (exemplar: the suite's existing deferred-navigation/dialog cases) covering (test-plan E8, E9): dirty plugin page + target → same confirmation round trip as the Save Bar chips; built-in draft dirty on General + target → navigates immediately, no prompt; deferred-then-confirmed navigation still consumes the pending scroll-target ref and scrolls the section in

## 3. Panel wiring

- [x] 3.1 In `SettingsPanel.tsx`, invoke the widened `usePiCompatibility` exactly once and render `PiRuntimeStatusRow` in the General block near `PiVersionAdvisory`, passing `piRuntime` to the row and `compatibility` + `onChangeRuntime` to the advisory; extend `settings-page-composition.test.tsx` (exemplar: itself) covering (test-plan E1, E6, E12): healthy fixture renders the row although the advisory renders nothing; fake timers advance 90s → exactly 2 `/api/health` fetches from the panel-owned hook and 0 from the row; clean panel shows no Save Bar and no General dirty chip because of the row

## 4. Advisory fix link

- [x] 4.1 In `packages/client/src/components/packages/PiVersionAdvisory.tsx`: consume `compatibility` via a prop (its internal `usePiCompatibility` call moves up to `SettingsPanel`) and add an optional `onChangeRuntime` prop rendering the same `Change…` affordance in both alert states; pass both at the `SettingsPanel` call site; the advisory stays conditional per `pi-core-version-check`, renders unchanged when `onChangeRuntime` is absent, and the permanent summary remains a separate element; extend `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx` (exemplar: itself) — delete the now-inert hook `vi.mock` and drive states via the `compatibility` prop (test-plan E10, E11: affordance present and invoking `onChangeRuntime` in Soft warning and Hard advisory states; unchanged render with the prop absent)

## 5. E2E coverage

- [x] 5.1 Extend `tests/e2e/pi-runtime-picker.spec.ts` (exemplar: itself — reuse its route-stub helpers; stub `/api/health` with `piRuntime` fixture state per the spec's existing health-route stub pattern) covering (test-plan F1, F2): healthy install → General row visible while advisory absent; `Change…` → URL exactly `/settings/developer` with no fragment or extra query and `[data-testid="pi-runtime-section"]` scrolled into view; Developer page still renders the picker immediately above `ToolsSection`
- [ ] 5.2 Run the extended spec against the docker harness with local changes (per `run-dashboard-e2e-local-changes`) until green

## 6. Docs + gates

- [x] 6.1 Add a purpose row for `PiRuntimeStatusRow.tsx` in `packages/client/src/components/settings/AGENTS.md`; update the `PiVersionAdvisory.tsx.AGENTS.md` row (`See change:`); run `kb dox lint` clean
- [ ] 6.2 Manual review on General (test-plan F3, manual-only — deferred post-merge per ship-change): confirm the two-line read-only status reads as status, not a form field, and does not crowd the page
- [ ] 6.3 Final gates: `openspec validate surface-pi-runtime-on-general`, `npm test`, `npm run build`; confirm zero diffs outside `packages/client/`, `packages/server/src/__tests__/health-shape.test.ts`, `tests/e2e/` and the doc rows — the `/api/health` `piRuntime` shape must gain no path or pinned indicator (design D2 gate, test-plan E7)
