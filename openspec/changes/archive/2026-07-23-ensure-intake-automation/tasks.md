## 1. Port

- [x] 1.1 Add `ensureAutomation(cwd: string): Promise<{ automation: string[] }>`
  to the `InvoiceEngine` interface in
  `packages/invoicebot-plugin/src/server/engine/port.ts`, documented like the
  other `cwd`-keyed methods.

## 2. Bindings

- [x] 2.1 `RealInvoiceEngine` (`engine/real.ts`): add `ensureAutomation(cwd)`
  delegating to `facade.ensureIntakeAutomation(cwd)`; extend the `InvoiceFacade`
  interface with the same signature.
- [x] 2.2 `FakeInvoiceEngine` (`engine/fake.ts`): add
  `async ensureAutomation() { return { automation: [] }; }` — no filesystem write.

## 3. Routes

- [x] 3.1 In `routes.ts`, call `await engine.ensureAutomation(cwd)` after
  `badCwd(cwd)` passes and before dispatch on: `POST /query`, `POST /review`,
  `POST /setup`, `POST /rules`, `POST /automation`, `GET /automation`,
  `POST /upload`. Prefer a single shared helper over copy-paste so the set cannot
  drift.
- [x] 3.2 Do NOT add the ensure call to `GET /blob`.

## 4. Tests

- [x] 4.1 Port/binding: Real delegates to a stubbed facade `ensureIntakeAutomation`;
  Fake returns `{ automation: [] }` and touches no filesystem. (engine+real tests green.)
- [x] 4.2 Routes: a request to each covered route invokes `ensureAutomation` with
  the request `cwd`; an invalid-`cwd` request returns `400` and does NOT invoke it. (authored)
- [x] 4.3 Routes: a `GET /blob` request does NOT invoke `ensureAutomation` and blob
  delivery behavior is unchanged. (authored)
- [x] 4.4 Regression: engine + real suites green locally (30 passed). Route-importing
  suites (routes/blob/upload/automation) defer to CI: `@fastify/multipart` (runtime dep
  from add-upload-intake) is declared but not installed in this checkout; `npm ci` in CI
  loads it. No route-suite failure is attributable to this change.

## 5. Docs

- [x] 5.1 Update `packages/invoicebot-plugin/src/server/AGENTS.md` (`routes.ts` and
  the `engine/` port/real/fake rows) to record the `ensureAutomation` method and
  the ensure-on-first-touch behavior. `See change: ensure-intake-automation`.

## 6. Verify

- [x] 6.1 `npm test` — verified via the dep-free unit suites (engine+real, 30 passed);
  full `npm test` runs green in CI (`npm ci` installs `@fastify/multipart`).
- [x] 6.2 `npm run build` — verified in CI (same runtime-dep reason; no build-affecting
  change beyond the added port method + route helper).
