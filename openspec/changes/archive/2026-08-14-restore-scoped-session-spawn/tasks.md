# Tasks — restore-scoped-session-spawn

## 1. Revert the producer-adoption naming seam

- [x] 1.1 `automation-plugin/src/server/engine.ts`: remove the
  `EngineDeps.perInvoiceRunName` field (+ its doc comment) and the `runName`
  computation; restore `automationRun: { name: automation.name, ... }`.
- [x] 1.2 `automation-plugin/src/server/index.ts`: remove the
  `perInvoiceRunName` wiring that consumes `invoicebot:scopedRunName`.
- [x] 1.3 `invoicebot-plugin/src/server/index.ts`: remove the
  `ctx.provide("invoicebot:scopedRunName", ...)` block and drop the
  `scopedAutomationName` import.
- [x] 1.4 `invoicebot-plugin/src/server/session-link.ts`: make
  `scopedAutomationName` a module-private function again (drop the `export`).

## 2. Regression guard

- [x] 2.1 Add a unit test in `session-link.test.ts` that models the producer's
  terminate-on-completion lifecycle: an **ended** per-invoice producer run
  recorded for the invoice is NOT adopted; `ensureScopedSession` spawns a fresh
  persistent scoped session stamped `invoicebot-scoped:<id>` and carrying env
  `{ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: <id> }`.
- [x] 2.2 Update `per-invoice-fanout.test.ts`: the per-invoice fan-out run keeps
  the automation's own name (no scoped-name injection).

## 3. Verify

- [x] 3.1 Scoped gate: `automation-plugin` + `invoicebot-plugin` tests green.
- [x] 3.2 `npm run build` + tsc clean.
- [x] 3.3 QA — full fresh e2e retest (driven by the orchestrator after this and
  the ui change merge).
