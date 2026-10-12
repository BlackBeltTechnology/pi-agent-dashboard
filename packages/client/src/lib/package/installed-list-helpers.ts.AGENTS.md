# installed-list-helpers.ts — index

Pure client helpers for installed-packages UI. Exports `computeDestIdentity(source)` — mirrors server `computeIdentity` for npm/git/https dedup; path sources fall back to literal string. See change: unify-package-management-ui.

## addons-hub-declutter

Adds `visibleInstalledRows`, `isLocalSourceRow` (classifySource local|git), `InstalledFilter`/`EMPTY_INSTALLED_FILTER`/`isInstalledFilterActive`/`filterInstalledRows` (text AND chips), `ADDONS_NPM_SEARCH_EVENT`. See change: addons-hub-declutter.
