## 1. Shared model

- [x] 1.1 Add `packages/shared/src/card-sections.ts`: `CARD_SECTION_IDS`, `CardSectionPrefs` type, `isValidSectionId`, `resolveCardSectionVisible`, `folderKeyForSession` (mainPath ?? cwd, `pathKey`). Verify with unit tests covering the resolution order, worktree key, and invalid ids.
- [x] 1.2 Add `set_card_section_visibility`, `reset_folder_card_sections`, and `card_sections_updated` to `browser-protocol.ts` unions. Verify `tsc --noEmit` passes.

## 2. Server persistence + transport

- [x] 2.1 `preferences-store.ts`: add the `cardSections` field with load-time sanitization, `getCardSections`, `setCardSectionVisibility(path|undefined, id, boolean|null): boolean`, and `resetFolderCardSections(path): boolean`. Folder keys use `pathKey` + `inferPlatform`. Enforce caps. Unknown valid ids are preserved. Verify with store tests: sparse delete, empty-folder removal, cap rejection, restart round-trip.
- [x] 2.2 Browser handler: validate the messages, call the store, and broadcast the `card_sections_updated` snapshot only on mutation. Send the snapshot on connect when non-empty. Verify with handler tests: a malformed id (`../x`) causes no mutation and no broadcast.

## 3. Client state

- [x] 3.1 Add a `CardSectionsContext` hydrated in `useMessageHandler` from `card_sections_updated`, plus the `useCardSectionVisible(session, id)` and `useCardSectionActions()` send helpers. Verify with a hook test: the snapshot updates visibility.
- [x] 3.2 Add `useSlotHasAnyClaims(slotId)` to `dashboard-plugin-runtime/src/slot-consumers.tsx`. Verify with a unit test for claims present and absent.

## 4. Card gating

- [x] 4.1 Desktop `SessionCard.tsx`: AND `useCardSectionVisible` into the gates for tags, spawn buttons, OPENSPEC, KB wrapper, GIT, STATUS, PROCESS, FLOWS, and MEMORY. Verify with RTL tests per section, including the "no prefs → identical render" snapshot.
- [x] 4.2 Mobile branch: the same gating for the sections it renders. Verify with an RTL test for the mobile scenario in the `session-card-subcards` delta.
- [x] 4.3 PROCESS safety chip, desktop and mobile. Verify with RTL tests: hidden + 1 background process shows the chip; hidden + 0 shows nothing; activating the chip opens the drawer.

## 5. Inline legend menu

- [x] 5.1 `SessionSubcard`: optional `menu` prop that renders a `⋯` button in the legend (focusable, `aria-label`, `stopPropagation`) and a menu with Hide in this folder / Hide everywhere / Section settings…. Verify with RTL tests: keyboard open, card not selected on click.
- [x] 5.2 Wire the hide actions to send the message and show a toast with an Undo action that restores the prior value. Section settings navigates to `/folder/:cwd/settings/cards`. Verify with RTL tests for undo and navigation.

## 6. Settings pages

- [x] 6.1 `DirectorySettings`: add the `cards` page (nav item, route), with tri-state rows grouped Sections / Plugin sections / Card lines, override badges, Reset to global, the OPENSPEC opt-out link, the context-bar link, and a synthetic live preview. Plugin rows are gated by `useSlotHasAnyClaims`. Verify with RTL tests: sparse write on Hide→Default, Reset disabled when there are no overrides, and the plugin row is absent when there are no claims.
- [x] 6.2 `SettingsPanel` Display: add a `CardSectionsSection` with global switches and per-row folder override counts. Verify with an RTL test showing the count of 2.
- [x] 6.3 i18n keys for every new label. Verify the i18n key check passes.

## 7. Docs + verification

- [x] 7.1 Update the `AGENTS.md` rows for the touched files (shared, server persistence, client session, DirectorySettings, runtime). Delegate the `docs/` prose (the preferences transport table) to DocScribe. Verify the rows are present.
- [x] 7.2 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`. Verify it's green.
- [ ] 7.3 Manual QA: with two browsers, hide GIT via the legend menu → both update. Restart the server → the setting persists. A worktree session follows the main folder. Mobile viewport respects the settings.
