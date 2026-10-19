## 1. Preconditions and baselines

- [x] 1.1 Run the baselines and keep the logs: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test-base.log`, `node scripts/theme-token-guard.mjs`, and `aligned-surfaces-no-literals.test.ts`. Verify: all green before any edit.
- [x] 1.2 Before any code edit:
  - add `packages/client-utils/src` and `packages/dashboard-plugin-runtime/src` to `SCAN_ROOTS` in `scripts/theme-token-guard.mjs`;
  - record their pre-existing findings with `--write`, in the same commit (design D8);
  - run the `aligned-surfaces` regex over the 9 files in design D8 and save the hit list in `openspec/changes/align-ui-contract-recipes/guard-baseline.md`.

  Verify: the guard exits 0, and the baseline diff only adds entries under the two new roots.

## 2. Runtime kit extensions (TDD, `dashboard-plugin-runtime/src/settings-fields.tsx`)

- [x] 2.1 Write failing tests, then add `remedies?: { icon: string; content: ReactNode }[]` to `SettingsNotice`, rendered as icon + content rows under `children` (links inside `content` stay focusable). Also set `aria-busy="true"` while `retrying`. Verify: new tests pass, and existing `SettingsNotice` tests pass unchanged.
- [x] 2.2 Write failing tests, then add `SettingsActionError({ id, children, details?, testId? })` (design D3) and export it from the runtime barrel. Cover: `role="alert"`, the `id` attribute, the visible sentence without `details`, and `SettingsCopyButton` copying `details`. Verify: tests pass.
- [x] 2.3 Write a failing test where `navigator.clipboard` is undefined, and one where `writeText` rejects. `SettingsCopyButton` must show its failure label, not "Copied". Fix it if needed. Verify: tests pass.
- [x] 2.4 Write a failing test, then add `spinning?: boolean` to `SettingsStatusPill`. It adds `animate-spin motion-reduce:animate-none` to the icon. Assert that the class is present and that a `prefers-reduced-motion` match leaves the icon static. Verify: tests pass, and existing pill tests pass unchanged.
- [x] 2.5 Gate: run `doubt-driven-review` (fresh-context + `@propose-review-N`) on the new kit props (`remedies`, `spinning`, `aria-busy`, `SettingsActionError`) before any core migration starts. Verify: findings resolved, or recorded in design.md. Tasks 3–5 do not start until this is done.
- [x] 2.6 Update the `packages/dashboard-plugin-runtime/src/AGENTS.md` row for `settings-fields.tsx` (`See change: align-ui-contract-recipes`). Verify: the row names `SettingsActionError`, `remedies` and `spinning`.

## 3. `ui:status-pill` renders the kit pill

- [x] 3.1 Write failing tests for `client-utils/src/StatusPill.tsx`:
  - the state → tone map from design D2;
  - the default icon per tone;
  - `running` passes `mdiLoading` with `spinning`;
  - an explicit icon key shows the tone default until it resolves, and stays on the default when the key is unknown;
  - `data-status-pill` keeps the raw state;
  - no inline `style` colour;
  - `tooltip` becomes `title`.

  Then implement: render `SettingsStatusPill`, and delete `STATE_STYLE_*` and `useIsLightTheme`. Verify: `vitest run packages/client-utils` passes and the props type is unchanged.
- [x] 3.2 Update the `packages/client-utils/src/AGENTS.md` row for `StatusPill.tsx`. Verify: the row is present.

## 4. Migrate services and vault

- [x] 4.1 Services (`settings/services/services-ui.tsx`):
  - `StatePill` → `SettingsStatusPill` (glyphs become MDI icons; label, `data-testid` and `data-state` kept);
  - `ServicesOperateCallout` → `SettingsNotice` + `remedies`;
  - `ActionFailure` → `SettingsActionError` with the code in `details`.

  Update tests that read the code text so they assert the copy payload. Verify: services tests pass.
- [x] 4.2 Vault (`settings/vault/vault-ui.tsx`, `OperateRequiredCallout.tsx`):
  - pills → `SettingsStatusPill`;
  - `Callout` and `OperateRequiredCallout` → `SettingsNotice` (copy, sign-in and "Request access" links, and `aria-busy` while retrying all kept);
  - `ErrorLine` and `FieldError` → `SettingsActionError`.

  Keep the "Couldn't load the vault: …" line a line. Delete `TONE_PILL` once it has no consumers. Verify: vault and `operate-required-remedy` tests pass.
- [x] 4.3 Update the `settings/services/AGENTS.md` and `settings/vault/AGENTS.md` rows. Verify: the rows name the kit parts.

## 5. Migrate the remaining pills

- [x] 5.1 `ProviderHealthPill.tsx` → `SettingsStatusPill` (`data-testid="health-pill"` and `data-state` kept). `provider-error-line` → `SettingsActionError` with the raw text in `details`. Verify: provider tests pass, no `text-green|yellow|red-400` remains, and a test asserts the raw error text is absent from visible text but present in the copy payload.
- [x] 5.2 `components/packages/plugin-row-parts.tsx`:
  - `StatusPill` → `SettingsStatusPill` with human words (raw state in `status`);
  - load-error `<pre>` → `SettingsNotice` with `details`.

  Add i18n keys for the new state words in every shipped locale catalog. Verify: plugin-list tests pass, no `text-[10px]` remains, and tests assert that `waiting_peers` and the load-error stack are absent from visible text, with the stack present in the copy payload.
- [x] 5.3 `OpenSpecBoardView.tsx` `BoardStatePill` → `SettingsStatusPill` (no 9 px uppercase). The rest of the file is untouched, and the `openspec-board-status-visuals` mapping is intact. Verify: board tests pass.
- [x] 5.4 Update the AGENTS.md rows for the three files. Verify: the rows are present.

## 6. Dialog (`client-utils/Dialog.tsx`)

- [x] 6.1 Write failing tests for the `dialog-system` deltas:
  - header icon tile in the info severity triple;
  - overlay `var(--bg-overlay)`;
  - panel `bg-[var(--bg-secondary)] border-[var(--border-secondary)] rounded-xl`;
  - title `text-lg font-semibold`;
  - root on `z-dialog`;
  - danger `--tint-red-*`, with no `bg-red-600`;
  - actions, Cancel and close at `min-h-[44px] sm:min-h-[36px]`.

  Then implement design D5. Verify: all `Dialog*.test.tsx` suites pass.
- [x] 6.2 Run the confirm and searchable-select dialog suites and every plugin test that renders `ui:dialog`. Verify: green, and no test id changed.
- [x] 6.3 Update the `client-utils/src/AGENTS.md` row for `Dialog.tsx`. Verify: the row is present.

## 7. Session actions menu (`SessionActionsPanel.tsx`)

- [x] 7.1 Write failing tests for the `session-actions-menu` ADDED requirement and design D6:
  - heading at 11 px semibold `--text-secondary`;
  - items at `min-h-[36px] max-sm:min-h-[44px]`;
  - the `More…` button and count in primary / secondary text;
  - disabled items `--text-secondary` + `aria-disabled`;
  - the reason as a wrapping 12 px block line referenced by `aria-describedby`;
  - the PLUGINS container sets `--text-primary`.

  Then implement. Verify: menu and deriver tests pass, and the hooks are unchanged.
- [x] 7.2 Update the AGENTS.md row for `SessionActionsPanel.tsx`. Verify: the row is present.

## 8. Settings rail (`SettingsPanel.tsx`, rail block only)

- [x] 8.1 Write failing tests for the `settings-panel` ADDED rail requirement and design D7:
  - no `--text-muted` or `opacity-60` in the rail;
  - items at `min-h-[36px] max-sm:min-h-[44px]`;
  - the current item with `aria-current`, tertiary fill and accent bar (bottom edge below `md`);
  - the Services attention marker as an icon with its `sr-only` count;
  - `nav-dirty-<id>` on a severity token;
  - a rendered-rail scan finding no raw palette classes or hex/rgba.

  Then implement. Verify: settings-panel tests pass, including the nav-group, collapse, promoted-entry and unsaved-changes suites.
- [x] 8.2 Update the `SettingsPanel.tsx.AGENTS.md` row. Verify: the row is present.

## 9. Scan list

- [ ] 9.1 Extend `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts` with `CLIENT_UTILS` and `RUNTIME` roots and the 9 files from design D8. Fix every remaining hit recorded in 1.2. Verify: the test passes, and temporarily reintroducing `bg-red-600` in `Dialog.tsx` makes it fail.
- [ ] 9.2 Update the AGENTS.md rows for `theme-token-guard.mjs`, its baseline and the scan test. Verify: the rows are present.

## 10. Contract and skills (after the code)

- [ ] 10.1 Update the `ui-contract.md` "Component invariants" table:
  - add or replace the rows for status pill, notice, inline action error, tabs, filter chip, menu / flyout, dialog, loading / empty / first-run, row overflow and settings rail;
  - start from the board's rows page, amended to the shipped code;
  - mark rows with no reference implementation "Adoption: pending (plugin wave)" (design D9).

  Verify: each row cites a change and references tokens only, and `ui-contract.md.AGENTS.md` is updated.
- [ ] 10.2 Sync `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/slot-taxonomy.md` with the frozen `SlotId` list. This is docs only, with no taxonomy change: add the 13 ids that are in `packages/shared/src/dashboard-plugin/slot-types.ts` but missing from the table. Verify: every `SlotId` appears in the table.
- [ ] 10.3 `references/host-design.md`: add sections on the settings kit (`SettingsStatusPill`, `SettingsNotice`, `SettingsActionError`), dialogs (`ui:dialog`, never a hand-built overlay), overlay pages and slot widgets, each pointing to its contract row. Verify: no raw colour in the file, and every section links a contract row.
- [ ] 10.4 `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`:
  - add a "plugin surface" binding: compose from the runtime kit and `ui:*` primitives, check the slot taxonomy, and reuse the board kit (`tokens.css`, `mockup.css`, `board.css`, `probe.js`) from the latest change;
  - refresh the GROUND example so it uses token names.

  Verify: the skill stays a thin adapter.

## 11. Verification and closeout

- [ ] 11.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Error|✗|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: no failures compared with the 1.1 baseline.
- [ ] 11.2 Client build plus an isolated instance on non-8000 ports (isolated-ui-verification skill). Open the Services page (rail, pills, notice), the vault page, a session actions menu, and a dialog of each intent, at 375 and 1440 px. Run the computed-contrast probe:
  - 4.5:1 in base dark, base light and nord dark;
  - 3:1 in the other named themes;
  - no horizontal overflow.

  Verify: screenshots are attached to the PR, and the live :8000 PID is unchanged.
- [ ] 11.3 Run `review-code` on the full diff. Verify: findings resolved or recorded.
- [ ] 11.4 Delegate any `docs/` prose that describes these components to DocScribe (caveman style). Verify: the DocScribe-returned rows are applied.

## 12. Tests (folded from test-plan.md)

- [x] 12.1 L1 test in `packages/client-utils/src/__tests__/StatusPill.test.tsx`: state → tone decision table. Input: `ui:status-pill` with each state in running, success, info, warn, error, muted and no icon. Trigger: render. Expected: tone classes `--severity-{info,success,info,warning,error,neutral}-*`, an svg icon each, `data-status-pill` = raw state, no colour in `style`. Harness exemplar: see packages/client-utils/src/__tests__/StatusPill.test.tsx (test-plan #E1)
- [x] 12.2 L1 test in `packages/client-utils/src/__tests__/StatusPill.test.tsx`: icon key fallback. Input: state warn, icon "mdiFlaskOutline", `useMdiIconByKey` mocked null then resolved; also unknown key "mdiNope". Trigger: render, then resolve. Expected: warning default icon first, then the flask path; the unknown key keeps the default. Harness exemplar: see packages/client-utils/src/__tests__/StatusPill.test.tsx (test-plan #E2)
- [x] 12.3 L1 test in `packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx`: `spinning` prop. Input: `SettingsStatusPill tone="info" spinning`, and the same without `spinning`. Trigger: render. Expected: icon has `animate-spin` and `motion-reduce:animate-none` only with `spinning`. Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx (test-plan #E3)
- [x] 12.4 L1 test in `packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx`: pill size. Input: `SettingsStatusPill` outside and inside a `SettingsItem` summary. Trigger: render. Expected: `text-[11px]` outside, `text-[12px]` inside. Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx (test-plan #E4)
- [x] 12.5 L1 test in `packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx`: notice remedies. Input: `SettingsNotice` with remedies A, B (content holds a login link), C; plus a props-only render. Trigger: render. Expected: rows in order A, B, C; the link is focusable; the props-only render matches its pre-change snapshot. Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx (test-plan #E5)
- [x] 12.6 L1 test in `packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx`: remedy order. Input: `operate_required` with remedies request-access, unknown-value, sign-in. Trigger: vault load refused. Expected: request-access row then sign-in row, no row for unknown-value, both links present. Harness exemplar: see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (test-plan #E6)
- [x] 12.7 L1 test in `packages/client/src/components/settings/services/__tests__/ServicesPages.test.tsx`: refused Stop. Input: stop mocked 409 with code stop_failed and message "permission denied". Trigger: click Stop. Expected: alert element referenced by Stop's `aria-describedby`; visible text lacks stop_failed; Copy-details payload holds the code and the message. Harness exemplar: see packages/client/src/components/settings/services/__tests__/ServicesPages.test.tsx (test-plan #E7)
- [x] 12.8 L1 test beside `components/packages/plugin-row-parts.tsx` under `packages/client/src/components/packages/__tests__/`: raw state and load error. Input: plugin row with status waiting_peers and a loadError stack. Trigger: render the plugin list. Expected: visible "Waiting for peers", `data-status="waiting_peers"`, the stack only in the Copy-details payload, no `text-[10px]`. Harness exemplar: see packages/client/src/components/settings/__tests__/ProviderHealthPill.test.tsx (test-plan #E8)
- [x] 12.9 L1 test in `packages/client/src/components/settings/__tests__/ProviderHealthPill.test.tsx`: provider pill migration. Input: states ok, not-tested and error with an error line. Trigger: render. Expected: `data-tone` set by the kit pill; `data-testid="health-pill"` and `data-state` unchanged; raw error only in the copy payload; no `text-(green|yellow|red)-400`. Harness exemplar: see packages/client/src/components/settings/__tests__/ProviderHealthPill.test.tsx (test-plan #E9)
- [x] 12.10 L1 test in `packages/client-utils/src/__tests__/Dialog.test.tsx`: dialog decision table. Input: Dialog with title and icon, actions with intent primary, danger and neutral, plus Cancel. Trigger: open. Expected: overlay `bg-[var(--bg-overlay)]`; panel `bg-[var(--bg-secondary)] border-[var(--border-secondary)] rounded-xl`; title `text-lg font-semibold`; tile `--severity-info-*`; primary `--accent-solid`; danger `--tint-red-*` and not `bg-red-600`; actions, Cancel and close `min-h-[44px] sm:min-h-[36px]`; root on `z-dialog`. Harness exemplar: see packages/client-utils/src/__tests__/Dialog.test.tsx (test-plan #E10)
- [x] 12.11 L1 test in `packages/client/src/components/__tests__/SessionCard.actions-menu.test.tsx`: menu floors. Input: session with cwdMissing, a group with 2 rare items, a plugin claim rendering a plain button. Trigger: open the menu. Expected: headings `text-[11px] font-semibold` in `--text-secondary`; items `min-h-[36px] max-sm:min-h-[44px]`; the disabled reason as a block `text-xs` element referenced by `aria-describedby`; More… and count not `--text-tertiary`; the plugin container sets `text-[var(--text-primary)]`. Harness exemplar: see packages/client/src/components/__tests__/SessionCard.actions-menu.test.tsx (test-plan #E11)
- [x] 12.12 L1 test beside `SettingsPanel.tsx` under `packages/client/src/components/settings/__tests__/`: rail. Input: `/settings/services` active, 1 service needing attention, a dirty vault page, a promoted plugin row. Trigger: render the panel. Expected: Services has `aria-current="page"` with tertiary fill and bar; the attention marker is an svg with the `sr-only` count; `nav-dirty-vault` has no `bg-amber-400`; the promoted row has no `opacity-60`; the rendered `settings-nav-rail` HTML has no palette class or hex/rgba. Harness exemplar: see packages/client/src/components/settings/__tests__/settings-heap-fields.test.tsx (test-plan #E12)
- [ ] 12.13 L1 test in `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`: surface list. Input: the 9 design-D8 files plus the existing list. Trigger: run the scan. Expected: passes, and a fixture copy of `Dialog.tsx` with `bg-red-600` fails, naming the file. Harness exemplar: see packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts (test-plan #E13)
- [x] 12.14 L1 test in `scripts/__tests__/theme-token-guard.test.mjs`: new roots. Input: a fixture file under `client-utils/src` and under `dashboard-plugin-runtime/src`, each with `var(--accent-primary, #60a5fa)`. Trigger: `scan()` with the new `SCAN_ROOTS`. Expected: both reported as new violations. Harness exemplar: see scripts/__tests__/theme-token-guard.test.mjs (test-plan #E14)
- [ ] 12.15 L3 test in `tests/e2e/services-settings.spec.ts`: palette switch. Input: Services page with a warning pill on the harness. Trigger: switch base dark to nord dark in Settings → Appearance. Expected: the pill's computed colours equal nord's `--severity-warning-*` without reload; contrast ≥ 4.5:1. Harness exemplar: see tests/e2e/services-settings.spec.ts (test-plan #F1)
- [ ] 12.16 L3 test in `tests/e2e/severity-contrast.spec.ts`: contrast sweep. Input: Services page (rail, pills, notice), vault page, session actions menu, one dialog per intent. Trigger: run the computed-contrast probe in base dark, base light and nord dark, then the 6 other named themes. Expected: 0 text < 4.5:1 in the three gated themes; 0 text < 3:1 in the others; 0 text < 11 px (12 px interactive). Harness exemplar: see tests/e2e/severity-contrast.spec.ts with tests/e2e/helpers/computed-contrast.ts (test-plan #F2)
- [ ] 12.17 L3 test in `tests/e2e/session-actions-menu.spec.ts`: touch targets at 375×800. Input: 375×800 viewport. Trigger: open `/settings/services`, then a session actions menu. Expected: the Services strip item ≥ 44 px with a bottom-edge bar; every menu item ≥ 44 px; `scrollWidth === clientWidth`. Harness exemplar: see tests/e2e/session-actions-menu.spec.ts (test-plan #F3)
- [ ] 12.18 L3 test in `tests/e2e/services-settings.spec.ts`: desktop rail height at 1280×800. Input: 1280×800 viewport. Trigger: open `/settings/general`. Expected: every `settings-nav-rail` button ≥ 36 px tall. Harness exemplar: see tests/e2e/services-settings.spec.ts (test-plan #F4)
- [ ] 12.19 Manual check after merge: compare the dialog, menu and rail in base dark, base light and nord dark with `mockups/index.html` S1–S3 (test-plan: manual-only, #F5)
- [x] 12.20 L1 test in `packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx`: clipboard failure. Input: `navigator.clipboard` undefined; second case `writeText` rejects. Trigger: click Copy details on a `SettingsActionError`. Expected: the failure label shows, never "Copied". Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx (test-plan #X1)
- [x] 12.21 L1 test in `packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx`: busy retry. Input: `SettingsNotice` whose onRetry returns a pending promise, with `retrying` driven by it. Trigger: click Try again twice. Expected: `aria-busy="true"` while pending; retry disabled; onRetry called once. Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/settings-fields.test.tsx (test-plan #X2)
- [x] 12.22 L1 test in `packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx`: generic load failure stays a line. Input: `GET /api/vault` 500, and a second case 403 operate_required without remedies. Trigger: load the vault page. Expected: the "Couldn't load the vault: …" line shows and no notice element renders in either case. Harness exemplar: see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (test-plan #X3)
- [x] 12.23 L1 test in `packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx`: operate-required busy. Input: operate_required with remedies, and the retry request held open. Trigger: click retry in the callout. Expected: the notice has `aria-busy="true"`, retry is disabled, and exactly one request is sent. Harness exemplar: see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (test-plan #X4)
