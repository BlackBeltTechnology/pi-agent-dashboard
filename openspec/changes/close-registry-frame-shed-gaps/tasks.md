## 1. `sessions_reordered` → state (`packages/server/src/pairing/browser-gateway.ts`)

- [ ] 1.1 Test class + key — the `frameClassOf` unit test: `sessions_reordered {cwd:"/a"}` → `{cls:"state", key:"sessions_reordered:/a"}`; two frames for `/a` and one for `/b` on a socket above threshold → none shed, on drain exactly one for `/a` (last ordering) and one for `/b` (pending-state coalesce test pattern from `fix-connect-snapshot-frame-loss`). Verify red first.
- [ ] 1.2 Implement D1 (one `case`). Verify 1.1 green; existing `browser-gateway-*` and `ws-frame-delivery` tests green; `docs/architecture.md` class table row moves (task 4.1).

## 2. Registry debt register (`browser-gateway.ts`, client `useMessageHandler.ts`)

- [ ] 2.1 Verify the client `session_added` upsert — read `useMessageHandler.ts:384` and the session-record consumers; confirm no client-local field lives ON the record (if one does, change the handler to `{...existing, ...msg.session}` and add a test). Record the finding in this line.
- [ ] 2.2 Test the four convergence scenarios — status-reconcile test file (`fix-backpressure-status-and-subagent-frames` pattern with the force-shed injector): (a) shed `session_added` (+`spawnRequestId`) → on drain `session_added` with the current full record and the id; (b) shed `session_removed`, session gone → `session_removed`; (c) add then remove shed → only `session_removed`; (d) remove then re-add shed → `session_added` with current record; (e) shed `session_updated` still yields `session_updated {status,currentTool}`; (f) counters `statusReconcileQueued/Sent` increment for every kind; (g) teardown releases entries. Verify red first (a–d).
- [ ] 2.3 Implement D2: `StatusDebt.entries` map with kind precedence, `broadcast()` dirty derivation for the three types, `flushStatusDebt` three-way emit reusing the `session_added` builder. Verify 2.2 green and the existing reconcile scenarios green.

## 3. Paging release + exhausted (`useMessageHandler.ts`, `SessionList.tsx`, `App.tsx`)

- [ ] 3.1 Test handler state — `useMessageHandler` test: `sessions_page_result {cwd:"/a", sessions:[], order:[], hasMore:false}` bumps `pageReplyGen["/a"]` and adds `/a` to `pageExhausted`; `hasMore:true` bumps and does not add; a `sessions_snapshot` or ended-transition changing `endedTotals["/a"]` removes `/a` from `pageExhausted`. Verify red first.
- [ ] 3.2 Test `SessionList` — existing paging test file: in-flight mark clears on `pageReplyGen` change with `pagedCount` unchanged (no 15 s wait — use fake timers to prove it did not rely on the timeout); exhausted cwd renders no "more" and a click sends nothing; after `pageExhausted` clears the affordance returns. Verify red first.
- [ ] 3.3 Implement D3 and thread both maps through `App.tsx`. Verify 3.1–3.2 green; `npm run build` clean.

## 4. Docs + closeout

- [ ] 4.1 Delegate to `DocScribe`: `docs/architecture.md` "Frame delivery policy" — `sessions_reordered` in the state list; debt register covers add/remove; paging release/exhausted rule. Verify grep `sessions_reordered` appears under the state class in the doc.
- [ ] 4.2 `AGENTS.md` rows: `packages/server/src/pairing/browser-gateway.ts.AGENTS.md` (class, debt shape, flush), `packages/client/src/hooks/AGENTS.md` (`useMessageHandler.ts`), `packages/client/src/components/session/AGENTS.md` (`SessionList.tsx`). Verify `kb dox lint` clean.
- [ ] 4.3 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean; comment on #648 and #649 (noting items 2–3 were already fixed) with the change name.
