## 1. #1135 — Failed label on session card

- [ ] 1.1 Failing test in `packages/client/src/components/session/__tests__/session-card-header-pure.test.tsx`: `activityContent` idle + `hasError` → "Failed"; retry/streaming/ended precedence kept; the `ActivityIndicator` wrapper with `hasError` renders "Failed" (covers the mobile line-2 path); a `SessionCard` render test (`SessionCard.test.tsx`) with `hasError` shows "Failed" in the desktop status row and the mobile line 2
- [ ] 1.2 `SessionCard.tsx`: add `hasError = false` param to `activityContent` and a `hasError` prop to the `ActivityIndicator` wrapper; `Failed` branch (existing `common.failed` key, default "Failed"; glyph `statusShapeIcon.error` via `StatusGlyph` widened to `"error"` with `--status-error`) replacing only the final `Idle` return; pass `hasError` at both call sites (desktop `activityContent` ~L1498, mobile `ActivityIndicator` ~L1246); update the precedence doc comment and the `activityContent` signature in `SessionCard.tsx.AGENTS.md:45`; no hu/zh-CN catalog edits (`common.failed` already exists there)
- [ ] 1.3 Add a lane regression test in `packages/client/src/lib/__tests__/session-lanes.test.ts`: idle + `hasError` → `error` lane (documents current behaviour)

## 2. #1154 — Token arrows `↓ in` / `↑ out` everywhere (D1 confirmed)

`TokenStatsBar` + `SessionSidebar` already render `↓in ↑out` (`TokenStatsBar.tsx:40-44,105-106`, `SessionSidebar.tsx:109-110`) and `token-stats-bar` spec is unchanged — no edits there.

- [ ] 2.1 Failing tests first: `packages/flows-plugin/src/__tests__/flow-agent-cost.test.tsx:215-226` → `↓12000` before `↑3000`; `packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx:141-151` → `↓1.2k` / `↑567`; new assertions that `TokenStats` (`SessionCard.tsx:468`) renders `{in}↓ {out}↑` and the `OpenSpecBoardView` session row (`OpenSpecBoardView.tsx:1386`) renders `{in}↓ {out}↑`
- [ ] 2.2 `SessionCard.tsx:474` (`TokenStats`): `{in}↓ {out}↑`
- [ ] 2.3 `OpenSpecBoardView.tsx:1386`: `{in}↓ {out}↑`
- [ ] 2.4 `packages/client-utils/src/minimal-chat/MinimalChatView.tsx:405`: `↓{input} ↑{output}`
- [ ] 2.5 `packages/flows-plugin/src/client/FlowAgentCard.tsx:106`: `↓{input} ↑{output}`; do not edit the bundled copies under `packages/electron/resources/` or `packages/electron/out/`
- [ ] 2.6 `grep -rnE "↑|↓" packages/*/src` — confirm no remaining input-up / output-down usage (git `↑`/`↓` ahead/behind chips and key-hint arrows are unrelated)

## 3. #1155 — Automation board loading/error + visible claim failure

- [ ] 3.1 Reproduce (`systematic-debugging`): open `/folder/:encodedCwd/automations` after server restart; record `/api/plugins/automation/list` status, whether the claim chunk loads and whether `claim.Component` is defined. Record the outcome in `design.md` before 3.5/3.6 are locked; if the cause differs from the lazy-chunk/fetch hypotheses, revisit the delta specs
- [ ] 3.2 Failing tests in `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`: pending → `automation-loading`; 503/reject → `automation-error` + Retry, no `automation-empty`, no `listRuns` call; Retry shows `automation-loading` then recovers; empty success → `automation-empty`; a mutation `refresh()` keeps the list rendered (no `automation-loading`) and a Stop whose result carries a notice still shows it after the refresh. Migrate the existing cases (`:97,103,342,457,611`) and the `vi.mock("../client/api.js")` factory (`:38-47`) from `listAutomations` to the new `fetchAutomations` (`{ok:true,automations}`); `FolderAutomationSection.test.tsx` stays on `listAutomations`
- [ ] 3.3 `api.ts`: add result-returning `fetchAutomations(cwd)` (`{ok:true,automations}|{ok:false,error}`); keep `listAutomations` for existing callers
- [ ] 3.4 `AutomationBoard.tsx`: replace `loaded` with `loadState` per design D5 (blocking `loading` only on initial load and Retry; mutation `refresh()` revalidates in place; any failed fetch → error, clears the list, skips `listRuns`), loading + error/Retry UI, i18n keys in `src/i18n.ts`
- [ ] 3.5 Failing tests in `packages/dashboard-plugin-runtime/src/__tests__/shell-overlay-route-presentation.test.tsx` (drives `ShellOverlayRouteSlot`): rejected lazy overlay claim, throwing overlay claim and a claim without `Component` render `overlay-claim-error` with Back calling `onBack`; a still-pending lazy claim renders `content-claim-loading` (`aria-busy`) and no error panel; in `slot-consumers.test.tsx` a throwing badge claim still renders nothing
- [ ] 3.6 `SlotErrorBoundary`: optional `fallback` prop (default `null`); `renderClaim` (`slot-consumers.tsx:99`) gains an optional 5th `errorFallback` param threaded to the boundary; `ShellOverlayRouteRender` passes the error panel with `onBack` and renders it directly when `claim.Component` is undefined; keep `ContentClaimSkeleton` unchanged (design D3)

## 4. #1156 — Canvas server chip

- [ ] 4.1 Failing tests in `packages/client/src/components/__tests__/CanvasDriver.test.tsx`: label capped + full title in `title`/`aria-label` (`<title> — 127.0.0.1:<port><path>` + probe hint); address `127.0.0.1:<port><path>` with the host:port part non-shrinking (`shrink-0`) and only the path truncating; slot tray left-aligned (no `items-end`); fixed fallback tray unchanged
- [ ] 4.2 `CanvasServerChip.tsx`: label `max-w-[32ch]`; `127.0.0.1:<port>` as a `shrink-0` span followed by a truncating path span; `title`/`aria-label` = `<title> — 127.0.0.1:<port><path>` + the existing probe hint
- [ ] 4.3 `CanvasDriver.tsx`: slot tray `items-start` (fallback keeps `items-end`)
- [ ] 4.4 Add a left-edge assertion to `tests/e2e/canvas-chip-tray-overlay.spec.ts` (chip left ≈ `composer-stack-anchor` left; the spec has no alignment assertion today; opt-in `npm run test:e2e`)

## 5. Verify and land

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary; `npm run quality:changed`
- [ ] 5.2 Client + `dashboard-plugin-runtime` changes: `npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`; check `curl -s http://localhost:8000/api/health | jq .mode`
- [ ] 5.3 Manual: card with error shows Failed in Failed lane; header token arrows; board in error state (stop server route / 503); chip with long title
- [ ] 5.4 `review-code` pass on the diff
- [ ] 5.5 `npx openspec validate fix-ui-status-indicators --strict` and `node scripts/check-conventions.mjs`
