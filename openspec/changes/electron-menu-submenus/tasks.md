## 1. Tests first

- [ ] 1.1 Add `packages/electron/src/lib/__tests__/app-menu.test.ts` (mock `electron`, `./servers-menu.js`, `./browser-host/consent.js`, other imports as needed); assert `buildWinLinuxMenuTemplate({ isDev: false })` top-level labels are exactly `["Dashboard","Edit","View","Help"]`
- [ ] 1.2 Assert Dashboard submenu order: Servers, Connect to Remote Dashboard…, Use Local Dashboard, Runtime, Browser relay, separator, `role: "quit"`
- [ ] 1.3 Assert Help order (non-dev): Doctor, Check for Updates…, View Update Log, separator, About; with `isDev: true` "Check for Updates…" absent
- [ ] 1.4 Assert Edit roles (undo, redo, separator, cut, copy, paste, selectAll) and View keeps Reload `CmdOrCtrl+R` / Force Reload `CmdOrCtrl+Shift+R`
- [ ] 1.5 Assert no top-level item other than the four menus has a `click` (no flat leaf items)
- [ ] 1.6 Run the new test; confirm it fails (builder missing)

## 2. Implementation

- [ ] 2.1 In `packages/electron/src/lib/app-menu.ts` add exported `buildWinLinuxMenuTemplate(opts?: { isDev?: boolean })` returning the grouped template (default `isDev` from `isDevMode()`)
- [ ] 2.2 Replace the inline flat template in `setupAppMenu()` (`:238-278`) with `Menu.buildFromTemplate(buildWinLinuxMenuTemplate())`; leave the darwin branch untouched
- [ ] 2.3 Update file header comment and `app-menu.ts.AGENTS.md` row (Win/Linux grouped Dashboard/Edit/View/Help); see change: electron-menu-submenus
- [ ] 2.4 Re-run `app-menu.test.ts` — passes

## 3. Verify

- [ ] 3.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`
- [ ] 3.2 `npm run quality:changed`
- [ ] 3.3 Manual: launch Electron build on Windows or Linux; confirm four top-level menus, every item fires its action, Servers submenu rebuilds on keyring change, Exit quits; confirm macOS menu unchanged
- [ ] 3.4 Extension reload not needed (Electron main only); rebuild Electron app (`cd packages/electron && npm run make`) for 3.3
- [ ] 3.5 `npx openspec validate electron-menu-submenus --strict` and `node scripts/check-conventions.mjs`
