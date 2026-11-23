# Tasks: card-sections-global-pointer

## 1. Settings deep-link (D4)
- [ ] 1.1 Test (L1, extend packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx, copy its scrollIntoView stub): input `/settings/general?scroll=card-sections-settings` with `/api/config` pending · trigger config resolves · observable `scrollIntoView` called exactly once on `[data-testid=card-sections-settings]` only after loading ends, then `navigate("/settings/general",{replace:true})` (test-plan #E6)
- [ ] 1.2 Test (L1, same file): input `/settings/general?scroll=does-not-exist` · trigger config resolves · observable no `scrollIntoView`, param removed via replace (test-plan #E7)
- [ ] 1.3 Test (L1, same file): input `?scroll=` values `"]`, `a"],body[x="`, 65 a's, `a b`, plus accepted `dep-chip-blockedBy` and 64 a's · trigger config resolves · observable no throw, no `querySelector` for values outside `^[A-Za-z0-9_-]{1,64}$`, param removed, the two accepted values queried (test-plan #E8)
- [ ] 1.4 Test (L1, same file): input `/settings/general` with no query, plus internal `requestRailNavigate("/settings/developer","pi-runtime-section")` · trigger render / rail click · observable no scroll or replace for the bare page; the rail target still scrolls and URL stays `/settings/developer` (test-plan #E9)
- [ ] 1.5 Test (L1, same file): input E6 setup inside `<React.StrictMode>` · trigger config resolves · observable `scrollIntoView` call count stays 1 (test-plan #F1)
- [ ] 1.6 Test (L1, same file): input `/api/config` rejects with `?scroll=card-sections-settings` · trigger mount · observable no throw, no `scrollIntoView`, no replace (test-plan #X1)
- [ ] 1.6a Test (L1, same file): input General mounted, config loaded, no query · trigger navigate to `/settings/general?scroll=card-sections-settings` · observable `scrollIntoView` once on `card-sections-settings`, then replace to `/settings/general` (test-plan #E12)
- [ ] 1.6b Test (L1, same file): input `/settings/plugins/kb?scroll=card-sections-settings` · trigger config resolves · observable replace to `/settings/plugins/kb` (sub kept), no `scrollIntoView` (test-plan #E13)
- [ ] 1.6c Test (L1, same file): input `/settings/general?scroll=x` and `/settings?tab=security&scroll=x` · trigger config resolves · observable General renders for the first; the second replace-navigates to `/settings/security` (test-plan #E14)
- [ ] 1.7 Implement the external `?scroll=` consumer in `SettingsPanel.tsx` per D4: `useSearch()`, consumed-ref reset when `scroll` is absent, wait for `!loading && config`, allowlist `^[A-Za-z0-9_-]{1,64}$` (no `CSS.escape`, no `try`/`catch`), replace to the current path keeping any `:sub`. Add `scroll-mt-*` only if 6.4 shows the block obscured.

## 2. Folder page pointer + label (D1, D2)
- [ ] 2.1 Test (L1, extend packages/client/src/components/__tests__/CardSectionsPage.test.tsx): input `/a` with 0 overrides and `canWrite=false` · trigger click `card-sections-open-global` · observable `navigate` called once with `/settings/general?scroll=card-sections-settings`, no replace, button enabled while `card-sections-reset` is disabled (test-plan #E1)
- [ ] 2.2 Test (L1, same file): input `/a` with 2 overrides, then 0 · trigger render · observable summary contains `follows the global defaults` / `Using the global defaults` (test-plan #E2)
- [ ] 2.3 Test (L1, same file): input global `git` hidden, `tags` visible, no `/a` override · trigger render · observable inherit options read `Global (Hide)` / `Global (Show)`, testid suffix `-inherit`, no `Default (` text (test-plan #E3)
- [ ] 2.4 Test (L1, same file): input `/a` override hides a legacy parent, child has no own override · trigger render then select the child's inherit option · observable child label `Global (Hide)`, no child key written (test-plan #E4)
- [ ] 2.5 Test (L1, see packages/client/src/components/folder/__tests__/FolderActionBanner.i18n.test.tsx): input locale hu, then zh-CN · trigger render `CardSectionsPage` · observable locale strings for `cardSections.globalShow`/`globalHide`/`editGlobalDefaults` render; `cardSections.defaultShow`/`defaultHide` are absent from both tables (test-plan #E5)
- [ ] 2.6 Implement in `CardSectionsPage.tsx` per D1/D2: `flex-wrap` strip with the two buttons in one nested `flex gap-2 shrink-0` container, link always enabled, `Global (…)` labels; add the hu/zh-CN strings specified in D2; remove `defaultShow`/`defaultHide`; update the stale `Default (…)` header comments (`CardSectionsPage.tsx:3,46`).

## 3. Single VIEW entry (D3)
- [ ] 3.1 Test (L1, extend packages/client/src/lib/session/__tests__/session-menu-items.test.ts): input `deriveSessionMenu` for a plain and a worktree session · trigger derive · observable VIEW ids equal exactly `["card-sections"]`, no `openCardDefaults` in the actions fixture (test-plan #E10)
- [ ] 3.2 Test (L1, extend packages/client/src/components/__tests__/SessionCard.card-sections.test.tsx): input desktop card in `/a` · trigger open the menu, activate card-sections · observable no `session-menu-item-card-defaults`, navigates to `/a`'s cards page, session not selected (test-plan #E11)
- [ ] 3.3 Remove the `card-defaults` item, the `openCardDefaults` action (`session-menu-items.ts`, `SessionCard.tsx`), the `sessionMenu.cardDefaults` inline fallback and the `mdiTune` import.

## 4. Navigation check
- [ ] 4.1 Test (L3, new tests/e2e/card-sections-global-pointer.spec.ts, see tests/e2e/card-block-toggles.spec.ts + helpers/card-sections.ts): input `FIXTURE_GIT` folder cards page `/folder/<cwd>/settings/cards` · trigger click `card-sections-open-global`, then `page.goBack()` · observable URL settles at `/settings/general` with no `scroll=` and `card-sections-settings` in the viewport; after Back the URL is `/folder/<cwd>/settings/cards` with the summary strip visible ; then click `card-sections-open-global` again · observable the block is in the viewport again (repeat trip) (test-plan #F2)
- [ ] 4.2 Test (L3, same spec): input Settings reached via the link · trigger press Escape · observable lands on `/folder/<cwd>/settings/cards` (test-plan #F3)
- [ ] 4.3 Manual: strip layout in dark and light themes at 375px and 1440px matches mock frame 1 (test-plan: manual-only, #F4)

## 5. Docs
- [ ] 5.1 `docs/session-actions-menu.md` VIEW group: one item (DocScribe, caveman style).
- [ ] 5.2 Update the `AGENTS.md` rows for the touched files (`CardSectionsPage.tsx`, `SettingsPanel.tsx`, `session-menu-items.ts`, `SessionCard.tsx`, the new e2e spec).

## 6. Gates
- [ ] 6.1 `npm test` (pipefail + tee) green. `npm run quality:changed`.
- [ ] 6.2 `review-code` pass.
- [ ] 6.3 `openspec validate card-sections-global-pointer`.
- [ ] 6.4 Client build + isolated verification (non-8000 port) of the click-through and Back, in dark and light.
