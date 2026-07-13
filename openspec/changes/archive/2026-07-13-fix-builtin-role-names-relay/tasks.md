# Tasks

## 1. Regression tests first (TDD — write, watch fail)

- [x] 1.1 Server relay test: in `packages/server/src/__tests__/`, feed a bridge `roles_list` message carrying `builtinRoleNames: ["planning","coding","compact","fast","vision","research"]` through the `event-wiring` handler and assert the broadcast to browser clients includes the same `builtinRoleNames` array. → verify: fails against current source (field dropped).
- [x] 1.2 Client handler test: in `packages/client/src/hooks/__tests__/` (or the existing `useMessageHandler` test), dispatch a `roles_list` message with `builtinRoleNames` and assert `getPluginConfig("roles").builtinRoleNames` equals the array. → verify: fails against current source.

## 2. Shared protocol type

- [x] 2.1 `packages/shared/src/browser-protocol.ts` — add `builtinRoleNames?: string[];` to `BrowserRolesListMessage` (mirror the optional field on `RolesListMessage` in `protocol.ts`). → verify: `tsc --noEmit` clean.

## 3. Server relay

- [x] 3.1 `packages/server/src/event-wiring.ts` (`roles_list` broadcast, ~line 1330) — add `builtinRoleNames: (msg as any).builtinRoleNames,` to the `broadcastToAll` payload. → verify: task 1.1 passes.

## 4. Client handler

- [x] 4.1 `packages/client/src/hooks/useMessageHandler.ts` (`roles_list` case, ~line 508) — add `builtinRoleNames: msg.builtinRoleNames` to the `roleInfo` object. → verify: task 1.2 passes.

## Tests

- [x] T.1 `npm test` green (new relay + handler tests included). → verify: tee→grep shows no FAIL.
- [x] T.2 Full suite type-check clean (`npm run quality:changed` or `tsc --noEmit`).

## Validate

- [x] V.1 Deploy: `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload` (client rebuild + server restart + bridge reload).
- [x] V.2 Manual (web dashboard): VERIFIED in system browser against live :8000 after deploy — ROLES shows Built-in group (@planning @coding @compact @fast @vision @research), Custom group (@review-model-1/2/3 with × remove), and "＋ Add custom role". builtinRoleNames now survives bridge→server→client.
- [x] V.3 Playwright e2e regression guard: `tests/e2e/roles-custom.spec.ts` (L3) — PASSED in system Chrome (PW_CHANNEL=chrome) against the Docker harness on local code (1 passed, 13.2s). — spawn a session, open `/settings/general`, assert `roles-group-builtin` (contains `@fast`) + `roles-group-custom` + `roles-add-custom` render and the add-custom flow reaches the model picker. Run in system browser: pre-build the per-worktree image, then `PW_CHANNEL=chrome npx playwright test roles-custom`. Settings → General → ROLES now shows **Built-in** and **Custom** group headers and a **"＋ Add custom role"** button. Adding `@myrole`, picking a model, and Save persists it; the × removes it. (Playwright e2e for this lives with the `add-custom-roles-ui` scenarios — extend there if a rendered-UI assertion is wanted.)
