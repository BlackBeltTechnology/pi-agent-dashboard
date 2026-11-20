## Why

[#1121](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1121): on Windows/Linux the Electron menu bar shows 10+ flat top-level entries (`View  Check for Updates…  View Update Log  About  Doctor  Servers  Connect to Remote Dashboard…  Use Local Dashboard  Runtime  Browser relay`), wasting title-bar width and breaking the File/Edit/View/Help desktop convention.

Root cause **CONFIRMED**: `packages/electron/src/lib/app-menu.ts:238-278` — the Windows/Linux `template` puts every item (plain click items + `serversMenuItem()` + `runtimeSubmenu()` + `buildBrowserRelayMenuItem()`) directly in the top-level array. macOS is already grouped (`app-menu.ts:173-236`). Also confirmed: Windows/Linux has no Edit menu today.

## What Changes

- Windows/Linux template regrouped into four top-level menus: **Dashboard** (Servers, Connect to Remote Dashboard…, Use Local Dashboard, Runtime, Browser relay, separator, Exit), **Edit** (undo/redo/cut/copy/paste/selectAll roles), **View** (unchanged items), **Help** (Doctor, Check for Updates… [hidden in dev], View Update Log, separator, About).
- Extract the Win/Linux template into an exported pure builder `buildWinLinuxMenuTemplate()` in `app-menu.ts` so the structure is unit-testable without a real `Menu`.
- macOS template, handlers, labels: **unchanged**.
- Fix stale spec text (`electron-shell` "minimal Help menu"; `electron-native-chrome` "flat top-level").

## Capabilities

### New Capabilities
_(none)_

### Modified Capabilities
- `electron-native-chrome`: Requirement "Application Menu" — Windows/Linux grouped submenu structure.
- `electron-shell`: Requirement "macOS application menu" — Windows/Linux scenario corrected (was stale "minimal Help menu").

## Non-goals

- No change to macOS menu, handlers (`handleCheckForUpdates`, `showDoctorDialog`, …), `serversMenuItem`, `runtimeSubmenu`, `buildBrowserRelayMenuItem` internals.
- No Window menu, no new menu items, no accelerator changes, no renamed item labels (Doctor stays "Doctor" on Win/Linux).
- No tray menu changes.

## Relationship

- Active `electron-platform-extraction` (unstarted: `packages/electron/src/platform/` absent) plans to move the "darwin template prefix" of `app-menu.ts` (it cites stale `app-menu.ts:29`) into `platform/menu.ts:buildAppMenu()` and states it will not change menu behaviour. Different concern; not edited here.
- **Recommendation: keep separate, land this first.** Extraction then moves an already-grouped template verbatim; the pure `buildWinLinuxMenuTemplate()` makes that move trivial and gives it a unit test it otherwise lacks (its design D-test skips `buildAppMenu`). Only textual overlap: both touch `setupAppMenu()` in `app-menu.ts`; resolve by rebasing extraction. Note extraction's `platform-primitives` delta types `buildAppMenu()` as returning `MenuItemConstructorOptions[]` vs its task 2.4 `Menu` — its own inconsistency, flagged in report.
- Archive sweep: no prior change addressed #1121 (`archive | grep menu` → UI menus only). Recent history: `add-operator-browser-relay` (#940) and `add-electron-server-windows` (#908) appended the flat Servers/Browser relay items.

## Discipline Skills

`review-code` (non-trivial change before commit). None other apply (no auth/secrets/endpoints/irreversible steps).

## Impact

- Files: `packages/electron/src/lib/app-menu.ts`, new `packages/electron/src/lib/__tests__/app-menu.test.ts`, `packages/electron/src/lib/app-menu.ts.AGENTS.md` (+ header comment), specs above.
- Docs: `docs/electron-session.md` mentions flat layout (historical session log — leave); delegate any `docs/` touch to DocScribe.
- Compat/rollback: UI-only, no persisted state or protocol; revert the commit. Users lose top-level access to items (muscle memory) — now under Dashboard/Help.
