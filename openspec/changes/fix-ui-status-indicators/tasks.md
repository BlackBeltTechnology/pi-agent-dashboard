## 1. #1135 — Failed label on session card

- [ ] 1.1 Failing test in `packages/client/src/components/session/__tests__/session-card-header-pure.test.tsx`: `activityContent` idle + `hasError` → "Failed"; retry/streaming/ended precedence kept
- [ ] 1.2 Add `hasError` param to `activityContent` (`SessionCard.tsx`), `Failed` branch replacing the `Idle` return; pass `hasError` from the `SessionCard` call site (~L1498); i18n key `session.failed`
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

- [ ] 3.1 Reproduce (`systematic-debugging`): open `/folder/:encodedCwd/automations` after server restart; record `/api/plugins/automation/list` status and whether the claim chunk loads
- [ ] 3.2 Failing tests in `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`: pending → `automation-loading`; 503/reject → `automation-error` + Retry, no `automation-empty`; Retry recovers; empty success → `automation-empty`
- [ ] 3.3 `api.ts`: add result-returning `fetchAutomations(cwd)` (`{ok:true,automations}|{ok:false,error}`); keep `listAutomations` for existing callers
- [ ] 3.4 `AutomationBoard.tsx`: `loadState` (`loading|error|ready`), loading + error/Retry UI, i18n keys in `src/i18n.ts`
- [ ] 3.5 Failing test in `packages/dashboard-plugin-runtime/src/__tests__/`: rejected lazy overlay claim and throwing overlay claim render `overlay-claim-error` with Back; a throwing badge claim still renders nothing
- [ ] 3.6 `SlotErrorBoundary`: optional `fallback` prop (default `null`); `ShellOverlayRouteRender` passes the error panel with `onBack`; replace `ContentClaimSkeleton` only if needed to make the loading state visible

## 4. #1156 — Canvas server chip

- [ ] 4.1 Failing tests in `packages/client/src/components/__tests__/CanvasDriver.test.tsx`: label capped + full title in `title`/`aria-label`; address `127.0.0.1:<port><path>`; slot tray left-aligned (no `items-end`); fixed fallback tray unchanged
- [ ] 4.2 `CanvasServerChip.tsx`: label `max-w-[32ch]`, tooltip/aria-label with full title + address, address text
- [ ] 4.3 `CanvasDriver.tsx`: slot tray `items-start` (fallback keeps `items-end`)
- [ ] 4.4 Update `tests/e2e/canvas-chip-tray-overlay.spec.ts` assertion for left alignment (opt-in `npm run test:e2e`)

## 5. Verify and land

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary; `npm run quality:changed`
- [ ] 5.2 Client + `dashboard-plugin-runtime` changes: `npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`; check `curl -s http://localhost:8000/api/health | jq .mode`
- [ ] 5.3 Manual: card with error shows Failed in Failed lane; header token arrows; board in error state (stop server route / 503); chip with long title
- [ ] 5.4 `review-code` pass on the diff
- [ ] 5.5 `npx openspec validate fix-ui-status-indicators --strict` and `node scripts/check-conventions.mjs`
