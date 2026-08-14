## 1. InvoiceBot publishes the scoped run name

- [x] 1.1 Export `scopedAutomationName` from
  `packages/invoicebot-plugin/src/server/session-link.ts`.
- [x] 1.2 In `packages/invoicebot-plugin/src/server/index.ts`, `ctx.provide`
  `"invoicebot:scopedRunName"` = `(invoiceId) => scopedAutomationName(invoiceId)`.

## 2. Automation fan-out stamps the injected per-invoice run name

- [x] 2.1 Add `EngineDeps.perInvoiceRunName?: (invoiceId: string) => string |
  undefined` in `packages/automation-plugin/src/server/engine.ts`.
- [x] 2.2 In `startRunFor`, compute the run name: when `fireCtx?.invoiceId` is
  set use `deps.perInvoiceRunName?.(fireCtx.invoiceId) ?? automation.name`, else
  `automation.name`; use it for the spawned `automationRun.name`.
- [x] 2.3 In `packages/automation-plugin/src/server/index.ts`, wire
  `perInvoiceRunName` to lazily `ctx.consume("invoicebot:scopedRunName")`.

## 3. Tests

- [x] 3.1 Engine: a per-invoice fire (`fireCtx.invoiceId` set) spawns with
  `automationRun.name` = the injected scoped name; a folder/global fire (no
  invoiceId) keeps `automation.name`; missing namer falls back to
  `automation.name`.
- [x] 3.2 session-link: a recorded producer surfaced as
  `invoicebot-scoped:<id>` (live, and ended-with-file) is adopted by
  `ensureScopedSession`; a recorded `invoicebot-intake` session is STILL NOT
  adopted (the §1c global-never-adopted guard is intact).

## 4. Validate

- [x] 4.1 `openspec validate adopt-scoped-producer-session --strict` passes.
- [x] 4.2 Scoped/related tests for the two plugins + `npm run build`; tsc clean.
