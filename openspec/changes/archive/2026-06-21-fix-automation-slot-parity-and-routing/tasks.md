## 1. Routing: board on a live slot

- [x] 1.1 In `packages/automation-plugin/package.json`, change the board claim from `{ slot: "command-route", command: "/automation" }` to `{ slot: "shell-overlay-route", component: "AutomationBoard", path: "/folder/:encodedCwd/automations" }`.
- [x] 1.2 Update `AutomationBoard.tsx` to derive `cwd` from `routeParams.encodedCwd` via `decodeFolderPath`; drop reliance on `session?.cwd`. Accept `onBack`/`onClose`.
- [x] 1.3 Confirm `routeParams` param name matches the `path` template (`encodedCwd`) against `ShellOverlayRouteSlot` in `dashboard-plugin-runtime`.
- [x] 1.4 Wrap board body in shell-overlay page chrome (sticky title + back), mirroring the OpenSpec board.

## 2. Sidebar parity re-skin

- [x] 2.1 Re-skin `FolderAutomationSection.tsx` to `FolderOpenSpecSection` anatomy: 10px uppercase title `AUTOMATIONS (N) →` + `mdiArrowRight`, refresh icon (`mdiRefresh`), `flex-1` spacer, right-aligned `+ New` blue chip.
- [x] 2.2 Preserve invalid-count `⚠ N` badge and the "render after first load, even at N=0" behavior.
- [x] 2.3 Navigate the title to `/folder/${encodeFolderPath(folder.cwd)}/automations`; wire `+ New` chip to open `CreateAutomationDialog` directly.
- [x] 2.4 Add `stopPropagation()` to handlers so the folder collapse trigger is not fired.

## 3. Tests

- [x] 3.1 Update `FolderAutomationSection.test.tsx`: assert OpenSpec-parity markup (uppercase title, refresh, `+ New` chip) and navigation target `/folder/<enc>/automations`.
- [x] 3.2 Add a test mounting the `shell-overlay-route` board claim at `/folder/:encodedCwd/automations` and asserting it renders with the decoded cwd.
- [x] 3.3 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` → green.

## 4. Docs

- [x] 4.1 Update `docs/file-index-plugins.md` rows for `FolderAutomationSection.tsx`, `AutomationBoard.tsx`, `package.json` (delegate per Documentation Update Protocol, caveman style).

## 5. Build & verify

- [x] 5.1 `npm run build` then `curl -X POST http://localhost:8000/api/restart`; reload pi sessions if extension untouched (client-only here).
- [x] 5.2 Visually confirm sidebar row matches OpenSpec row and the link opens the full board.
